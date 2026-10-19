# Tingxian · Guqin Tuner

[简体中文](README.md) | **English**

A seven-string guqin tuner designed for phones, supporting **Zheng Diao (正调), Man San (慢三), Jin Wu (紧五), and Man Er (慢二)**. It provides an offline Android app and a browser version that share the same interface and pitch detection engine. Audio is processed entirely on the device; recordings are neither saved nor uploaded.

**The app interface is currently available in Simplified Chinese.**

<img src="docs/images/mobile-preview.png" alt="Tingxian guqin tuner on a phone, showing the Chinese interface" width="320">

## Features

- Select strings 1–7 manually or use automatic string detection. Man Er uses manual selection because strings 1 and 2 have the same pitch.
- View the target frequency, detected frequency, deviation in cents, and whether the pitch is sharp or flat.
- An “in tune” indication appears when the pitch stays within ±5 cents for approximately 650 milliseconds.
- Adjust the A4 reference frequency from 415 to 466 Hz in whole-Hz increments. The default is 440 Hz, using twelve-tone equal temperament.
- Play reference tones. Pitch detection pauses during playback and the decay period to avoid measuring the phone's speaker output as a string.
- Save tuning, string selection, and reference-frequency preferences locally. The microphone stops when you leave the tuner screen or put the app in the background.
- The Android app bundles all web assets. The browser version supports asset caching and adding the app to the home screen.

## Tuning Chart

The chart uses scientific pitch notation, with middle C written as C4. Strings are listed from the lowest, string 1, to the highest, string 7.

| Tuning | String 1 | String 2 | String 3 | String 4 | String 5 | String 6 | String 7 | Change from Zheng Diao |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Zheng Diao (正调) | C2 | D2 | F2 | G2 | A2 | C3 | D3 | Common reference tuning |
| Man San (慢三), also 慢角调 | C2 | D2 | E2 | G2 | A2 | C3 | D3 | Lower string 3 by one semitone |
| Jin Wu (紧五), also 蕤宾调 | C2 | D2 | F2 | G2 | B♭2 | C3 | D3 | Raise string 5 by one semitone |
| Man Er (慢二), also 慢商调 | C2 | C2 | F2 | G2 | A2 | C3 | D3 | Lower string 2 by one whole tone to match string 1 |

At A4 = 440 Hz, the target frequencies for Zheng Diao are **65.41, 73.42, 87.31, 98.00, 110.00, 130.81, and 146.83 Hz**, respectively. String 3 in Man San is **82.41 Hz**; string 5 in Jin Wu is **116.54 Hz**.

These are common modern pitches used as an electronic tuning reference. Historical absolute pitches, traditional tuning by matching harmonics, and practices taught in different guqin lineages may differ. Use a shared reference pitch when playing with other instruments.

## Installation and Use

### Android

[Download the Android APK from the GitHub Release](https://github.com/yonakiluo-hub/tingxian-guqin-tuner/releases/tag/v1.0.0), or build it from source using the instructions below. The APK is distributed as a Release asset and is not committed to the Git source history. This is currently an evaluation build and is not available through an app store.

Requires **Android 8.0 or later** and a recent version of **Android System WebView / Chrome**. After installation, select a tuning and string, tap “开始调音” (“Start tuning”), grant microphone permission, and pluck one open string at a time. The bundled app works offline, and its Android manifest does not request internet permission.

### Mobile Browsers

Deploy all contents of [guqin-tuner/dist](guqin-tuner/dist/) to a static website served over **HTTPS**, then open it in a recent version of Safari, Chrome, or another compatible browser. On iPhone, choose “Add to Home Screen” from Safari's Share menu. On Android, install the app or add it to the home screen from the browser menu.

The first visit needs to load the complete set of assets, and microphone access requires permission. Once the browser has successfully cached the app, it can work offline. Clearing site data or the cache requires another online load.

### Tuning Tips

1. Choose the tuning required by your piece. Manual string selection is recommended when getting started.
2. Place your phone beside the guqin and pluck one open string at a time. Lightly touch the other strings to mute them.
3. Let the initial plucking transient pass, then watch the stable reading: a negative value means flat, so gently tighten the string; a positive value means sharp, so gently loosen it.
4. If the difference is large, check the selected string and octave first. Make small adjustments, then check all seven strings again.

## Run the Web App Locally

Requires **Node.js 22+**. There are no npm dependencies to install and no frontend build step. From the repository root, run:

```sh
cd guqin-tuner
npm start
```

Open [http://localhost:4173](http://localhost:4173) on the same computer. The development server listens only on the local loopback address, so a phone cannot access it through the computer's LAN address. Browser microphone access generally requires HTTPS or localhost on the device itself; a plain HTTP LAN address cannot be used for microphone capture on a phone.

For the web app structure and development notes, see [guqin-tuner/README.md (Chinese)](guqin-tuner/README.md).

## Build the Android App

Requires **Python 3.10+, JDK 17, Android SDK Platform 35, and Build-Tools 35.0.0**. Gradle is not required. Run the following commands from the repository root on **Windows x64**:

```powershell
# Download the official portable toolchain into work/downloads/ and work/toolchain/
python android/setup_toolchain.py

# Compile, package, and sign the web assets and Android wrapper
python android/build.py --web-dir guqin-tuner/dist --out-dir outputs
```

If you already have the toolchain, you can skip the download and set `JAVA_HOME` and `ANDROID_SDK_ROOT` to your installations. The SDK must contain `platforms/android-35` and `build-tools/35.0.0`. The portable toolchain download script targets Windows x64; builds on other operating systems have not been verified.

Build outputs:

- `outputs/Tingxian-Guqin-Tuner-Android.apk`: an installable evaluation APK.
- `outputs/Android-Build-Verification.txt`: signature, manifest, and SHA-256 verification results.

The first build generates a local evaluation signing key in `android/signing/`. Keep the same key to install subsequent versions as updates over an existing installation, and do not commit signing files to a public repository. Before production distribution, configure and securely retain a release signing key. The evaluation signing key generated by the current script is not suitable for a production app-store release.

For more information about permissions and lifecycle handling, see [android/README.md (Chinese)](android/README.md).

## Tests and Verification Scope

From the repository root, run:

```sh
cd guqin-tuner
npm test
```

The current **18 automated tests** cover:

- Target pitches for all seven strings across four tunings, plus reference-frequency calibration.
- 44.1 / 48 kHz input, 8192 / 16384-sample windows, pitch deviations in cents, strong harmonics, noise, and decay.
- Rejection of silence, invalid input, and out-of-range pure tones, without silently folding detected pitches into a different octave.
- Microphone permission cancellation and denial, resource cleanup, background suspension, reference-tone suppression, stable-pitch detection, and automatic string selection.

The recorded maximum error across 252 principal synthetic-audio cases is approximately **0.178 cents**. This is a synthetic-data result and **does not represent accuracy with a phone's microphone**. App behavior tests use simulated DOM and audio environments. Android build checks cover compilation, packaging, signatures, and the manifest. These checks do not replace testing on physical devices.

## Project Structure

```text
.
├── README.md
├── README.en.md
├── guqin-tuner/
│   ├── dist/                 # Deployable pages, scripts, styles, and icons
│   │   ├── app.js            # Interaction, audio lifecycle, and reading stabilization
│   │   ├── pitch.js          # Single-note pitch detection and cents calculation
│   │   ├── tunings.js        # Tunings and target frequencies
│   │   └── sw.js             # Browser app asset caching
│   ├── tests/                # Pitch detection and app behavior tests
│   ├── server.mjs            # Local development server
│   └── package.json
├── android/
│   ├── app/src/main/         # Android WebView wrapper, permissions, and resources
│   ├── build.py              # Compilation, packaging, signing, and verification
│   └── setup_toolchain.py    # Windows portable toolchain setup
└── docs/images/              # Project screenshots
```

## Current Limitations

- Microphone accuracy has not yet been validated with a real guqin on physical Android or iPhone devices.
- The single-note algorithm does not support plucking multiple strings at once. A weak fundamental, isolated harmonics, low-frequency room noise, lingering resonance, and phone noise suppression may cause unstable or incorrect readings.
- When only a pure second harmonic remains, the audio alone cannot identify the originating string an octave below. Strings tuned to the same pitch cannot be distinguished automatically either. Select the target string manually and verify by ear.
- The current tuning system is twelve-tone equal temperament. Pythagorean tuning and just intonation are not yet available.
- Reference tones are synthesized, rather than sampled from a guqin. Bluetooth audio may add latency or alter the low-frequency response.
- An open-source license has not yet been specified.

## References

- [The Palace Museum: “Guqin Tuning Methods” (Chinese)](https://www.dpm.org.cn/Uploads/File/2022/10/25/u6357951133e58.pdf): Zheng Diao and the string adjustments used for Man San, Jin Wu, and Man Er.
- [Atlas Ensemble: Guqin by Ziwen Kong](https://www.atlasensemble.nl/assets/files/instruments/Guqin/Guqin%20by%20Ziwen%20Kong.pdf): common open-string pitches and scientific pitch notation.
- [de Cheveigné & Kawahara (2002): YIN, a fundamental frequency estimator for speech and music](https://pubmed.ncbi.nlm.nih.gov/12002874/): a reference for pitch detection. This project's independent implementation uses the normalized difference-function approach, with candidate selection adapted for low-pitched plucked strings.
