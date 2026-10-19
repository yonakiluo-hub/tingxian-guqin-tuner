"""Download a portable Windows Android toolchain from official distribution hosts."""
import concurrent.futures
import hashlib
import pathlib
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
DOWNLOADS = WORK / "downloads"
TOOLCHAIN = WORK / "toolchain"
DOWNLOADS.mkdir(parents=True, exist_ok=True)
TOOLCHAIN.mkdir(parents=True, exist_ok=True)

def download(name, url, checksum=None, algorithm="sha1"):
    dest = DOWNLOADS / name
    if not dest.exists():
        print("Downloading", name, flush=True)
        partial = dest.with_suffix(dest.suffix + ".partial")
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        partial.replace(dest)
    if checksum:
        actual = hashlib.new(algorithm, dest.read_bytes()).hexdigest()
        if actual != checksum:
            raise ValueError(f"Checksum mismatch: {name}: {actual}")
    print("Verified", name, dest.stat().st_size, flush=True)
    with zipfile.ZipFile(dest) as archive:
        archive.extractall(TOOLCHAIN)
    print("Extracted", name, flush=True)

jobs = [
    ("build-tools.zip", "https://dl.google.com/android/repository/build-tools_r35_windows.zip", "af059bb67cf7786f45ee0db85e2d24985df1b4b6"),
    ("platform.zip", "https://dl.google.com/android/repository/platform-35_r02.zip", "0bb560a90a7a2cbd0dd8348224d518b638fe7949"),
    ("jdk.zip", "https://aka.ms/download-jdk/microsoft-jdk-17.0.20.1-windows-x64.zip",
        "3d9006956fc8af5601cd24ffc4f468bef48279c7ebd8171b9bdf90d0aabfbf1f", "sha256"),
]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    futures = [executor.submit(download, *job) for job in jobs]
    for future in concurrent.futures.as_completed(futures):
        future.result()

print("Portable build toolchain ready:", TOOLCHAIN, flush=True)
