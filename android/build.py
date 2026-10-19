"""Build the offline Android APK without Gradle or third-party Java dependencies.

Usage from the repository root: python android/build.py
Environment overrides: JAVA_HOME, ANDROID_SDK_ROOT.
"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT.parent
WORK = ROOT / "work"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web-dir", type=Path, default=ROOT / "guqin-tuner" / "dist")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "outputs")
    args = parser.parse_args()
    web = args.web_dir.resolve()
    out = args.out_dir.resolve()
    if not (web / "index.html").is_file():
        raise SystemExit("Build the web app first: index.html is missing from " + str(web))

    portable = WORK / "toolchain"
    jdk_candidates = sorted(portable.glob("jdk-*"))
    java_home = Path(os.environ.get("JAVA_HOME", str(jdk_candidates[-1]) if jdk_candidates else ""))
    sdk = Path(os.environ.get("ANDROID_SDK_ROOT", str(portable)))
    build_tools = sdk / "build-tools" / "35.0.0" if (sdk / "build-tools").exists() else sdk / "android-15"
    platform = sdk / "platforms" / "android-35" if (sdk / "platforms").exists() else sdk / "android-35"
    ext = ".exe" if os.name == "nt" else ""
    java = java_home / "bin" / ("java" + ext)
    javac = java_home / "bin" / ("javac" + ext)
    jar = java_home / "bin" / ("jar" + ext)
    keytool = java_home / "bin" / ("keytool" + ext)
    aapt2 = build_tools / ("aapt2" + ext)
    zipalign = build_tools / ("zipalign" + ext)
    android_jar = platform / "android.jar"
    for required in [java, javac, jar, keytool, aapt2, zipalign, android_jar]:
        if not required.is_file():
            raise SystemExit("Required tool not found: " + str(required) + ". Run setup_toolchain.py or set JAVA_HOME and ANDROID_SDK_ROOT.")

    def run(*command, **kwargs):
        print("Running", Path(command[0]).name, flush=True)
        # Windows SDK tools may misread non-ASCII absolute arguments. Keep paths
        # relative to this directory; CreateProcessW still resolves the Unicode cwd.
        arguments = [str(command[0])]
        for part in command[1:]:
            if isinstance(part, Path):
                try:
                    part = os.path.relpath(part, PROJECT)
                except ValueError:
                    pass  # An explicitly configured SDK may live on another drive.
            arguments.append(str(part))
        return subprocess.run(arguments, cwd=PROJECT, check=True, **kwargs)

    out.mkdir(parents=True, exist_ok=True)
    build_parent = PROJECT / "build"
    build_parent.mkdir(exist_ok=True)
    # Keep signing identity local so future builds can update the installed APK.
    # It is an evaluation key, not a production/app-store release identity.
    signing = PROJECT / "signing"
    signing.mkdir(exist_ok=True)
    keystore = signing / "qixian-local-test.p12"
    if not keystore.exists():
        run(keytool, "-genkeypair", "-keystore", keystore, "-storetype", "PKCS12", "-alias", "qixian",
            "-storepass", "local-evaluation-only", "-keypass", "local-evaluation-only", "-keyalg", "RSA",
            "-keysize", "3072", "-validity", "3650", "-dname", "CN=Qixian Local Evaluation, O=Local Development, C=CN")

    with tempfile.TemporaryDirectory(prefix="apk-", dir=build_parent) as temporary:
        stage = Path(temporary)
        classes = stage / "classes"
        dex = stage / "dex"
        assets = stage / "assets" / "www"
        classes.mkdir()
        dex.mkdir()
        shutil.copytree(web, assets)
        manifest = PROJECT / "app" / "src" / "main" / "AndroidManifest.xml"
        resources = manifest.parent / "res"
        source = manifest.parent / "java"
        compiled_resources = stage / "resources.zip"
        run(aapt2, "compile", "--dir", resources, "-o", compiled_resources)
        resource_apk = stage / "resource.apk"
        run(aapt2, "link", "-o", resource_apk, "--manifest", manifest, "-I", android_jar,
            "--min-sdk-version", "26", "--target-sdk-version", "35", "--version-code", "1", "--version-name", "1.0.0",
            "-A", assets.parent, compiled_resources)
        java_sources = sorted(source.rglob("*.java"))
        run(javac, "-encoding", "UTF-8", "-source", "8", "-target", "8", "-bootclasspath", android_jar,
            "-d", classes, *java_sources)
        class_jar = stage / "classes.jar"
        run(jar, "cf", class_jar, "-C", classes, ".")
        run(java, "-cp", build_tools / "lib" / "d8.jar", "com.android.tools.r8.D8", "--min-api", "26",
            "--lib", android_jar, "--output", dex, class_jar)
        with zipfile.ZipFile(resource_apk, "a", zipfile.ZIP_DEFLATED) as apk:
            for dex_file in sorted(dex.glob("*.dex")):
                apk.write(dex_file, dex_file.name)
        aligned = stage / "aligned.apk"
        run(zipalign, "-f", "-p", "4", resource_apk, aligned)
        apk_path = out / "Tingxian-Guqin-Tuner-Android.apk"
        run(java, "-jar", build_tools / "lib" / "apksigner.jar", "sign", "--ks", keystore, "--ks-key-alias", "qixian",
            "--ks-pass", "pass:local-evaluation-only", "--key-pass", "pass:local-evaluation-only",
            "--v4-signing-enabled", "false", "--out", apk_path, aligned)
        run(zipalign, "-c", "-p", "4", apk_path)
        result = run(java, "-jar", build_tools / "lib" / "apksigner.jar", "verify",
            "--verbose", "--print-certs", apk_path, capture_output=True, text=True, encoding="utf-8")
        print(result.stdout)
        verification = out / "Android-Build-Verification.txt"
        badging = run(build_tools / ("aapt" + ext), "dump", "badging", apk_path,
            capture_output=True, text=True, encoding="utf-8")
        digest = hashlib.sha256(apk_path.read_bytes()).hexdigest()
        verification.write_text("听弦 · 古琴调音器 Android 构建验证\n\n"
            + "SHA-256: " + digest + "\n\n" + result.stdout + "\n" + badging.stdout
            + "\n验证范围：编译、APK 打包、签名和 manifest 检查。未连接安卓真机，不代表已完成真机麦克风测试。\n",
            encoding="utf-8")
        print("APK:", apk_path)
        print("SHA-256:", digest)

if __name__ == "__main__":
    main()
