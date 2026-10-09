import './style.css';
declare global {
  interface Window {
    nerathisDesktop?: {
      captureScreenshot: () => Promise<{ path: string; bytes: number }>;
      openScreenshotsFolder: () => Promise<{ path: string; error: string }>;
      openLogsFolder: () => Promise<{ path: string; error: string }>;
      setGraphicsMode: (mode: 'vanilla' | 'hd') => Promise<{ graphicsMode: string; hdAvailable: boolean }>;
      writeDiagnosticLog: (entry: unknown) => Promise<{ ok: boolean }>;
      getVersionInfo: () => Promise<Record<string, unknown>>;
    };
  }
}
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const loadingOverlay = document.getElementById('loadingOverlay')!;
const loadingMessage = document.getElementById('loadingMessage')!;
const loadingDetail = document.getElementById('loadingDetail')!;
const loadingProgress = document.getElementById('loadingProgress') as HTMLElement;
const errorOverlay = document.getElementById('errorOverlay')!;
const errorContent = document.getElementById('errorContent')!;
document.getElementById('dismissError')?.addEventListener('click', () => errorOverlay.classList.add('is-hidden'));

function setProgress(value: number, message: string) {
  loadingMessage.textContent = message;
  loadingDetail.textContent = `${Math.round(value * 100)}% · WebGL scene`;
  loadingProgress.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
}

const params = new URLSearchParams(window.location.search);
const desktopRuntime = window.location.protocol === 'app:' && Boolean(window.nerathisDesktop);
const missionVaoLabMode = import.meta.env.DEV && params.get('missionVaoLab') === '1';
const belayaLabMode = import.meta.env.DEV && params.get('belayaLab') === '1';
const joleeLabMode = import.meta.env.DEV && params.get('joleeLab') === '1';
const jkaDonorIsolationLabMode = import.meta.env.DEV && params.get('jkaDonorIsolationLab') === '1';
const ebonHawkLabMode = import.meta.env.DEV && params.get('ebonHawkLab') === '1';
const jediAcademyLabMode = import.meta.env.DEV && params.get('jediAcademyLab') === '1';
const roshGripLabMode = import.meta.env.DEV && params.get('roshGripLab') === '1';
const roshDefenseLabMode = import.meta.env.DEV && params.get('roshDefenseLab') === '1';
const jkaPairCombatLabMode = import.meta.env.DEV && params.get('jkaPairCombatLab') === '1';
const jkaControlSwapLabMode = import.meta.env.DEV && params.get('jkaControlSwapLab') === '1';
const jkaHostileLabMode = import.meta.env.DEV && params.get('jkaHostileLab') === '1';
const academyCandidateMode = (import.meta.env.DEV || desktopRuntime) && (params.get('academyCandidate') === '1' || params.get('world') === 'academy');
const academyCombatLabMode = (import.meta.env.DEV || desktopRuntime) && params.get('academyCombatLab') === '1';
const kotorCharacterGalleryMode = import.meta.env.DEV && params.get('kotorCharacterGallery') === '1';
const w236VerticalSliceMode = import.meta.env.DEV && params.get('verticalSlice') === 'ebon-to-anchorhead';
const anchorheadMode = params.get('kotorAnchorheadViewer') === '1';

function startDesktopPlaytestControls() {
  if (!desktopRuntime) return;
  const bar = document.createElement('div');
  bar.id = 'nerathisDesktopControls';
  bar.style.cssText = 'position:fixed;right:12px;top:12px;z-index:50;display:flex;gap:5px;align-items:center;padding:6px 8px;background:rgba(7,16,24,.88);border:1px solid #547184;border-radius:5px;color:#d8e8f0;font:11px Segoe UI,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35)';
  const status = document.createElement('span');
  status.textContent = 'PLAYTEST';
  status.style.cssText = 'margin-right:3px;color:#a9d8e9;font-weight:600';
  const toast = (message: string) => {
    status.textContent = message;
    window.setTimeout(() => { status.textContent = 'PLAYTEST'; }, 2600);
  };
  const add = (label: string, action: () => void) => {
    const control = document.createElement('button');
    control.textContent = label;
    control.style.cssText = 'background:#263b4a;color:#fff;border:1px solid #668396;border-radius:3px;padding:3px 6px;cursor:pointer;font:11px Segoe UI,sans-serif';
    control.onclick = action;
    bar.appendChild(control);
  };
  bar.appendChild(status);
  add('Vanilla', () => void window.nerathisDesktop?.setGraphicsMode('vanilla'));
  add('Dantooine HD', () => void window.nerathisDesktop?.setGraphicsMode('hd'));
  add('F9 Capture', () => void window.nerathisDesktop?.captureScreenshot().then(result => toast(`PNG ${Math.round(result.bytes / 1024)} KB`)).catch(() => toast('CAPTURE ERROR')));
  add('F10 Folder', () => void window.nerathisDesktop?.openScreenshotsFolder().then(() => toast('CAPTURES OPEN')));
  add('Logs', () => void window.nerathisDesktop?.openLogsFolder().then(() => toast('LOGS OPEN')));
  document.body.appendChild(bar);
  window.addEventListener('keydown', event => {
    if (event.key === 'F9') { event.preventDefault(); void window.nerathisDesktop?.captureScreenshot().then(result => toast(`PNG ${Math.round(result.bytes / 1024)} KB`)).catch(() => toast('CAPTURE ERROR')); }
    if (event.key === 'F10') { event.preventDefault(); void window.nerathisDesktop?.openScreenshotsFolder().then(() => toast('CAPTURES OPEN')); }
    if (event.key === 'F8') { event.preventDefault(); const details = document.querySelector('details'); if (details) details.open = !details.open; }
  });
  void window.nerathisDesktop?.getVersionInfo().then(info => {
    if (info.hdAvailable !== true) toast('HD UNAVAILABLE · VANILLA');
  });
}
startDesktopPlaytestControls();
  if (kotorCharacterGalleryMode) {
  import('./dev/kotor/CharacterConversionGalleryLab').then(({ startCharacterConversionGalleryLab }) => startCharacterConversionGalleryLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (academyCombatLabMode) {
  // Canonical Academy combat host.  It delegates to the existing party lab;
  // no second combat engine or alternate party controller is created.
  params.set('jediAcademyLab', '1'); params.set('party', '1');
  params.set('leader', 'aren-native-jka-v1'); params.set('nara', 'native-jka-v1');
  import('./dev/kotor/JediAcademyPartyLab').then(({ startJediAcademyPartyLab }) => startJediAcademyPartyLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? error.message : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (academyCandidateMode) {
  import('./dev/kotor/AcademyPrologueCandidateLab').then(({ startAcademyPrologueCandidateLab }) => startAcademyPrologueCandidateLab(canvas)).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (jkaHostileLabMode) {
  import('./dev/kotor/JkaHostileMercenaryLab').then(({ startJkaHostileMercenaryLab }) => startJkaHostileMercenaryLab(canvas)).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (jkaPairCombatLabMode || jkaControlSwapLabMode) {
  import('./dev/kotor/JkaPairCombatLab').then(({ startJkaPairCombatLab }) => startJkaPairCombatLab(canvas)).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (roshDefenseLabMode) {
  import('./dev/kotor/RoshDefenseLab').then(({ startRoshDefenseLab }) => startRoshDefenseLab(canvas)).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (roshGripLabMode) {
  import('./dev/kotor/RoshNativeGripLab').then(({ startRoshNativeGripLab }) => startRoshNativeGripLab(canvas)).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (w236VerticalSliceMode) {
  import('./dev/kotor/W236VerticalSlice').then(({ startW236VerticalSlice }) => startW236VerticalSlice()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (missionVaoLabMode) {
  import('./dev/kotor/MissionVaoLab').then(({ startMissionVaoLab }) => startMissionVaoLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (jkaDonorIsolationLabMode) {
  import('./dev/kotor/JkaDonorIsolationLab').then(({ startJkaDonorIsolationLab }) => startJkaDonorIsolationLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (jediAcademyLabMode && params.get("party") === "1") {
  import('./dev/kotor/JediAcademyPartyLab').then(({ startJediAcademyPartyLab }) => startJediAcademyPartyLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? error.message : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (jediAcademyLabMode) {
  import('./dev/kotor/JediAcademyLab').then(({ startJediAcademyLab }) => startJediAcademyLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? error.message : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (ebonHawkLabMode) {
  import('./dev/kotor/EbonHawkLab').then(({ startEbonHawkLab }) => startEbonHawkLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? error.message : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (belayaLabMode) {
  import('./dev/kotor/BelayaCharacterLab').then(({ startBelayaLab }) => startBelayaLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (joleeLabMode) {
  import('./dev/kotor/JoleeCharacterLab').then(({ startJoleeLab }) => startJoleeLab()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else if (anchorheadMode) {
  import('./dev/kotor/AnchorheadViewer').then(({ startAnchorheadViewer }) => startAnchorheadViewer()).catch((error: unknown) => {
    errorContent.textContent = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorOverlay.classList.remove('is-hidden');
  });
} else {
  const { Game } = await import('./game/Game');
  const game = new Game(canvas);
  game.start(setProgress).then(() => {
    setProgress(1, 'Ready');
    window.setTimeout(() => loadingOverlay.classList.add('is-hidden'), 260);
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
    errorContent.textContent = `path: local GLB bundle\n${detail}`;
    errorOverlay.classList.remove('is-hidden');
    loadingMessage.textContent = 'Some assets could not be loaded';
    loadingDetail.textContent = 'See the error panel to continue';
  });
}





