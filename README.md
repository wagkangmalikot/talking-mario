# Talk to Mario (Android)

A talk-only kids app. Tap the big red button, ask a question out loud, and Mario answers out loud about the Mushroom Kingdom.

## Get the APK (no Android Studio needed)
1. Create a new GitHub repo and push this whole folder to the `main` branch.
2. Open the repo's **Actions** tab. The **Build APK** run starts by itself (or press **Run workflow**).
3. When it turns green (about 5 minutes), open the run and download **TalkToMario-apk** under *Artifacts*. Unzip it to get `TalkToMario.apk`.
4. Copy the APK to the Android phone and open it. Allow "Install unknown apps" when asked.

## Or build on your own computer
Needs Node 22, JDK 21 and Android Studio (Android SDK 35).
```
npm install
npm run build:apk
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Or run `npx cap open android` and use **Build > Build APK(s)**.

## First launch (grown-ups)
- Paste a Claude API key from console.anthropic.com in the setup panel (⚙️). It is saved only on that phone.
- Pick Mario's voice and press **Test voice**. Italian voices give him his accent. If none are listed, press **Get more voices** and download Italian in Google Text-to-speech.
- Allow the microphone when asked.

## Editing
The whole app is `www/index.html`. After changing it, run `npx cap sync android` (or just push; GitHub rebuilds the APK).
