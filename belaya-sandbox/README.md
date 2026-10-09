# Belaya — NERATHIS isolated browser lab

This Vite app intentionally runs **outside** E:\\NerathisWeb and uses only a local copy of Belaya's already-converted GLB. It reuses the `src/dev/kotor/BelayaDialogueV1.ts` conversation implementation from the audit branch.

## Setup (Windows PowerShell)
From `E:\\SW_WEB_AUDIT` after checking out `feature/belaya-dialogue-v1`:

```powershell
$source = 'E:\NerathisWeb\public\_lab\kotor\characters\belaya\belaya_kotor1_donor.glb'
$dest = 'E:\SW_WEB_AUDIT\belaya-sandbox\public\_lab\kotor\characters\belaya\belaya_kotor1_donor.glb'
if (!(Test-Path -LiteralPath $source)) { throw "Missing source GLB: $source" }
New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
Copy-Item -LiteralPath $source -Destination $dest
Set-Location E:\SW_WEB_AUDIT\belaya-sandbox
npm install
npm run dev
```

Visit **http://127.0.0.1:5189**. Only sandbox files are written. The 29.9 MB GLB stays ignored by Git.

Controls: WASD moves a **blue test marker**, E talks when within 2.8 meters, mouse rotates the camera. ESC closes the conversation. Buttons test `pause1` and `talk`.

This is a **visual and dialogue integration smoke test**, not the Academy runtime, navmesh, or original story-system validation. Text is playtest copy; VO/LIP and global quest states are not implemented.
