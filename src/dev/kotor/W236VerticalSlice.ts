import type { W236LifecycleState, W236ResourceCounts, W236WorldRuntimeHandle } from './W236WorldLifecycle';
import { createW236Session, W236_WORLD_DEFINITIONS, WorldTransitionController } from './W236WorldLifecycle';

type W236Window = Window & {
  __nerathisWorldState?: Record<string, any>;
  __ebonHawkLabState?: Record<string, any>;
  __anchorheadRuntimeMetrics?: Record<string, any>;
  __anchorheadPlayableTest?: Record<string, any>;
  __w236VerticalSlice?: Record<string, any>;
  __w236AnchorheadTest?: { runPthSmoke(mode: 'walk' | 'run'): Promise<Record<string, any>> };
};
type W236DebugKind = 'BWM' | 'PTH' | 'VIS' | 'DOORS' | 'PARTY' | 'LIFECYCLE';

const win = window as W236Window;
const clone = <T,>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value)) as T;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function setQuery(values: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

export async function startW236VerticalSlice() {
  const requestedLeader = new URLSearchParams(window.location.search).get('playable')?.toLowerCase() === 'jolee' ? 'jolee' : 'aren';
  const requestedPreset = new URLSearchParams(window.location.search).get('partyPreset') === 'belaya' ? 'belaya_donor' : 'default';
  const session = createW236Session(requestedLeader, requestedPreset);
  const controller = new WorldTransitionController();
  const root = document.createElement('div');
  root.id = 'w236VerticalSliceHud';
  root.style.cssText = 'position:fixed;inset:0;z-index:20000;color:#eaf5f4;font:12px/1.45 ui-monospace,Consolas,monospace;pointer-events:none;text-shadow:0 1px 5px #000';
  document.body.appendChild(root);
  const header = document.createElement('div');
  header.style.cssText = 'position:absolute;left:14px;top:12px;padding:9px 12px;background:#071019df;border:1px solid #54747b;border-radius:6px';
  header.textContent = 'NERATHIS · W236 · EBON HAWK → ANCHORHEAD';
  root.appendChild(header);
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:absolute;left:14px;top:49px;margin:0;padding:10px;background:#071019df;border:1px solid #54747b;border-radius:6px;min-width:330px;max-height:52vh;overflow:auto;white-space:pre-wrap';
  root.appendChild(panel);
  const stateJson = document.createElement('script');
  stateJson.id = 'w236StateJson';
  stateJson.type = 'application/json';
  root.appendChild(stateJson);
  const message = document.createElement('div');
  message.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:340px;padding:18px 24px;text-align:center;background:#060a0ff5;border:1px solid #7b9ca3;border-radius:8px;font-size:16px;opacity:0;transition:opacity .28s ease';
  root.appendChild(message);
  const exit = document.createElement('button');
  exit.textContent = 'E  ·  EXIT SHIP';
  exit.style.cssText = 'position:absolute;left:50%;bottom:9%;transform:translateX(-50%);padding:14px 24px;border:1px solid #b3e7e8;border-radius:8px;background:#0b3b42ed;color:#fff;font:700 16px ui-monospace,Consolas,monospace;pointer-events:auto;cursor:pointer;display:none';
  root.appendChild(exit);
  const routeButton = document.createElement('button');
  routeButton.textContent = 'DEV · WALK TO SOURCE EXIT';
  routeButton.style.cssText = 'position:absolute;left:50%;bottom:9%;transform:translateX(-50%);padding:12px 18px;border:1px solid #b3e7e8;border-radius:8px;background:#0b3b42ed;color:#fff;font:700 14px ui-monospace,Consolas,monospace;pointer-events:auto;cursor:pointer;display:none';
  root.appendChild(routeButton);
  const walkButton = document.createElement('button');
  walkButton.textContent = 'ANCHORHEAD · WALK 20M';
  walkButton.style.cssText = 'position:absolute;left:50%;bottom:9%;transform:translateX(-50%);padding:12px 18px;border:1px solid #b3e7e8;border-radius:8px;background:#0b3b42ed;color:#fff;font:700 14px ui-monospace,Consolas,monospace;pointer-events:auto;cursor:pointer;display:none';
  root.appendChild(walkButton);
  const runButton = document.createElement('button');
  runButton.textContent = 'ANCHORHEAD · RUN 20M';
  runButton.style.cssText = 'position:absolute;left:50%;bottom:2%;transform:translateX(-50%);padding:12px 18px;border:1px solid #b3e7e8;border-radius:8px;background:#0b3b42ed;color:#fff;font:700 14px ui-monospace,Consolas,monospace;pointer-events:auto;cursor:pointer;display:none';
  root.appendChild(runButton);
  const resourceLog: Array<{ phase: string; counts: W236ResourceCounts | null }> = [];
  const metrics: Record<string, any> = { transitionTotalMs: null, worldDisposeMs: null, anchorheadLoadAndSpawnMs: null, timeToReadyMs: null, actorDisposeMs: null, ebonBefore: null, ebonAfterActors: null, ebonAfterDispose: null, anchorheadAfterLoad: null, errors: [] as string[], uncaughtExceptions: [] as string[] };
  let runtime: W236WorldRuntimeHandle | null = null;
  let transitioning = false;
  let showHud = true;
  let activeDebug: Record<W236DebugKind, boolean> = { BWM: false, PTH: false, VIS: false, DOORS: false, PARTY: false, LIFECYCLE: false };
  let transitionStartedAt = 0;

  const state: Record<string, any> = {
    session: clone(session),
    lifecycleState: 'IDLE' as W236LifecycleState,
    currentWorld: clone(W236_WORLD_DEFINITIONS.ebon_hawk_003ebo),
    leader: null,
    party: null,
    transition: null,
    vis: null,
    resources: null,
    diagnostics: { resourceLog, metrics, activeWorldCount: 0, activeCameraCount: 0, duplicateActors: false, staleEbonVisibility: false, exitRouteResult: null, anchorheadMovementSmoke: {} },
  };
  const updateState = () => {
    const runtimeState = runtime?.state() ?? null;
    const eb = win.__ebonHawkLabState;
    const ah = win.__anchorheadRuntimeMetrics;
    if (state.currentWorld?.id === 'ebon_hawk_003ebo') {
      state.leader = clone(runtimeState?.party ?? eb?.party ?? null);
      state.party = clone(runtimeState?.party ?? eb?.party ?? null);
      state.vis = clone(eb ? { currentRoom: eb.currentRoom, visibleRooms: eb.visibleRooms, fallbackCount: eb.visFallbackCount } : null);
    } else {
      state.leader = clone(runtimeState?.navigation ?? runtimeState?.leader ?? null);
      state.party = clone(runtimeState?.party ?? null);
      state.vis = clone(runtimeState?.vis ?? (ah ? { currentRoom: ah.currentRoom, enabledRooms: ah.enabledRooms, fallback: ah.visFallback, fallbackCount: ah.visFallbackCount } : null));
    }
    state.resources = runtime?.snapshot() ?? state.resources;
    const actorCounts = state.resources?.actorCounts ?? { aren: 0, mission: 0, jolee: 0, nara: 0 };
    state.diagnostics.actorCounts = actorCounts;
    state.diagnostics.activeCameraCount = state.resources?.activeCameraCount ?? 0;
    state.diagnostics.activeWorldCount = runtime && !state.resources?.disposed ? 1 : 0;
    state.diagnostics.duplicateActors = actorCounts.aren > 1 || actorCounts.mission > 1 || actorCounts.jolee > 1 || actorCounts.nara > 1;
    state.diagnostics.staleEbonVisibility = state.currentWorld?.id !== 'ebon_hawk_003ebo' && Boolean(win.__ebonHawkLabState);
    state.transition = clone(session.lastTransition ? { ...session.lastTransition, lifecycleState: state.lifecycleState } : { lifecycleState: state.lifecycleState, sequence: session.transitionSequence });
    state.session = clone(session);
    win.__nerathisWorldState = clone(state);
    stateJson.textContent = JSON.stringify(state);
    const leader = state.leader ?? {};
    const party = state.party ?? {};
    const partyMembers = Array.isArray(party.party) ? party.party : Array.isArray(party.companions) ? party.companions : [];
    const mission = party.mission ?? partyMembers.find((member: any) => String(member.id).toLowerCase() === 'mission') ?? null;
    const jolee = party.jolee ?? partyMembers.find((member: any) => String(member.id).toLowerCase() === 'jolee') ?? null;
    const nara = party.nara ?? partyMembers.find((member: any) => String(member.id).toLowerCase() === 'nara') ?? null;
    const exitAvailable = state.currentWorld?.id === 'ebon_hawk_003ebo' && Boolean(eb?.exitAvailable);
    exit.style.display = exitAvailable && !transitioning ? 'block' : 'none';
    const inEbon = state.currentWorld?.id === 'ebon_hawk_003ebo';
    const inAnchorhead = state.currentWorld?.id === 'anchorhead_tat_m17aa';
    routeButton.style.display = inEbon && !transitioning && !state.diagnostics.exitRouteResult?.pass ? 'block' : 'none';
    walkButton.style.display = inAnchorhead && !transitioning ? 'block' : 'none';
    runButton.style.display = inAnchorhead && !transitioning ? 'block' : 'none';
    if (showHud) {
      panel.style.display = 'block';
      panel.textContent = [
        `WORLD  ${state.currentWorld?.id ?? '—'} · ${state.currentWorld?.moduleResRef ?? '—'}`,
        `GAME   ${state.currentWorld?.sourceGame ?? '—'} · ${state.currentWorld?.navigationConvention ?? '—'}`,
        `ROOM   ${leader.room ?? eb?.currentRoom ?? '—'} · FACE ${leader.face ?? '—'} · VIS ${state.vis?.enabledRooms ?? state.vis?.visibleRooms?.length ?? '—'} · fallback ${state.vis?.fallbackCount ?? eb?.visFallbackCount ?? '—'}`,
        `${session.leaderId.toUpperCase()}   ${leader.animationState ?? leader.locomotionState ?? '—'} · ${(leader.distanceWalked ?? leader.distance ?? 0).toFixed?.(2) ?? '0'}m walked · ${(leader.distanceRun ?? 0).toFixed?.(2) ?? '0'}m run`,
        `MISSION ${mission?.room ?? '—'} · ${mission?.behavior ?? mission?.target?.state ?? '—'} · ${(mission?.distance ?? 0).toFixed?.(2) ?? '0'}m`,
        `NARA    ${nara?.room ?? '—'} · ${nara?.behavior ?? nara?.target?.state ?? '—'} · ${(nara?.distance ?? 0).toFixed?.(2) ?? '0'}m · ${session.partyPreset}`,
        `JOLEE   ${jolee?.room ?? '—'} · ${jolee?.behavior ?? jolee?.target?.state ?? '—'} · ${(jolee?.distance ?? 0).toFixed?.(2) ?? '0'}m`,
        `TRANSITION ${state.lifecycleState} · seq ${session.transitionSequence}`,
        `timing total ${metrics.transitionTotalMs == null ? '—' : `${Math.round(metrics.transitionTotalMs)}ms`} · dispose ${metrics.worldDisposeMs == null ? '—' : `${Math.round(metrics.worldDisposeMs)}ms`} · load ${metrics.anchorheadLoadAndSpawnMs == null ? '—' : `${Math.round(metrics.anchorheadLoadAndSpawnMs)}ms`}`,
        'F1 HUD · F2 BWM · F3 PTH · F4 VIS · F5 DOORS · F6 PARTY · F7 LIFECYCLE',
      ].join('\n');
    } else panel.style.display = 'none';
  };

  const setLifecycleState = (next: W236LifecycleState) => { state.lifecycleState = next; updateState(); };
  const setDebug = (kind: W236DebugKind) => {
    activeDebug[kind] = !activeDebug[kind];
    runtime?.setDebug(kind, activeDebug[kind]);
    updateState();
  };
  const fadeOut = async () => {
    message.textContent = 'Leaving the Ebon Hawk…'; message.style.opacity = '1';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
  };
  const fadeIn = async () => {
    message.textContent = `ANCHORHEAD · ${session.leaderId.toUpperCase()} + ${session.party.map((member) => member.id.toUpperCase()).join(' + ')}`;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    message.style.opacity = '0';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 360));
  };

  const onError = (event: ErrorEvent) => { metrics.errors.push(event.message || 'WINDOW_ERROR'); updateState(); };
  const onRejection = (event: PromiseRejectionEvent) => { metrics.uncaughtExceptions.push(String(event.reason)); updateState(); };
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || /^INPUT|TEXTAREA|SELECT$/.test((event.target as HTMLElement | null)?.tagName ?? '')) return;
    const keys: Record<string, keyof typeof activeDebug> = { F2: 'BWM', F3: 'PTH', F4: 'VIS', F5: 'DOORS', F6: 'PARTY', F7: 'LIFECYCLE' };
    if (event.key === 'F1') { showHud = !showHud; updateState(); event.preventDefault(); return; }
    if (keys[event.key]) { setDebug(keys[event.key]); event.preventDefault(); return; }
    if (event.key.toLowerCase() === 'e' && exit.style.display !== 'none') { requestExit(); event.preventDefault(); }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('keydown', onKey, true);

  const requestExit = async () => {
    if (transitioning || session.currentWorldId !== 'ebon_hawk_003ebo' || !win.__ebonHawkLabState?.exitAvailable) return;
    transitioning = true;
    exit.disabled = true;
    session.transitionSequence++;
    transitionStartedAt = performance.now();
    session.lastTransition = {
      sequence: session.transitionSequence,
      transitionId: 'EBON_HAWK_TO_ANCHORHEAD',
      fromWorld: 'ebon_hawk_003ebo', toWorld: 'anchorhead_tat_m17aa', reason: 'SOURCE_TRIGGER_SEMANTIC',
      startedAt: Date.now(), completedAt: null, status: 'REQUESTED',
    };
    updateState();
    try {
      const destination = await controller.transition({
        setState: setLifecycleState,
        fadeOut,
        fadeIn,
        freezeInput: (frozen) => runtime?.freezeInput(frozen),
        disposeActors: async () => {
          metrics.ebonBefore = runtime?.snapshot() ?? null;
          const result = runtime?.disposeActors() ?? null;
          metrics.ebonAfterActors = result;
          resourceLog.push({ phase: 'EBON_AFTER_ACTORS', counts: result });
          return result as W236ResourceCounts;
        },
        disposeWorld: async () => {
          const result = runtime?.disposeWorld() ?? null;
          metrics.ebonAfterDispose = result;
          resourceLog.push({ phase: 'EBON_AFTER_DISPOSE', counts: result });
          runtime = null;
          updateState();
          return result as W236ResourceCounts;
        },
        loadDestination: async () => {
          session.previousWorldId = session.currentWorldId;
          session.currentWorldId = 'anchorhead_tat_m17aa';
          state.currentWorld = clone(W236_WORLD_DEFINITIONS.anchorhead_tat_m17aa);
          updateState();
          const playableName = session.leaderId === 'jolee' ? 'Jolee' : 'Aren';
          setQuery({ ebonHawkLab: null, playable: playableName, party: null, companion: null, companions: null, partyPreset: session.partyPreset === 'belaya_donor' ? 'belaya' : null, kotorAnchorheadViewer: '1', anchorheadOptimization: 'merge-vis', anchorheadNavDebug: '0', anchorheadFreeze: null, playableTest: null });
          const { startAnchorheadViewer } = await import('./AnchorheadViewer');
          const loaded = await startAnchorheadViewer({
            verticalSlice: true,
            companions: session.party.map((member) => member.id),
            onLifecycleState: setLifecycleState,
            onRuntimeCreated: (handle) => { runtime = handle; updateState(); },
            onLoadFailure: (error) => { metrics.errors.push(`ANCHORHEAD_LOAD: ${String(error)}`); },
          });
          runtime = loaded;
          metrics.anchorheadAfterLoad = loaded.snapshot();
          resourceLog.push({ phase: 'ANCHORHEAD_AFTER_LOAD', counts: metrics.anchorheadAfterLoad });
          session.lastTransition!.status = 'READY';
          session.lastTransition!.completedAt = Date.now();
          return loaded;
        },
        onMilestone: (name, durationMs) => {
          metrics[name] = Math.round(durationMs);
          if (name === 'transitionTotalMs') { metrics.transitionTotalMs = Math.round(durationMs); metrics.timeToReadyMs = Math.round(performance.now() - transitionStartedAt); }
          updateState();
        },
      });
      runtime = destination;
      session.lastTransition!.status = 'READY';
      session.lastTransition!.completedAt ??= Date.now();
      updateState();
    } catch (error) {
      session.lastTransition!.status = 'FAILED';
      metrics.errors.push(`TRANSITION_FAILED: ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
      setLifecycleState('FAILED');
      message.textContent = `WORLD TRANSITION FAILED\n${error instanceof Error ? error.message : String(error)}`;
      message.style.opacity = '1';
    } finally {
      transitioning = false;
      exit.disabled = false;
      updateState();
    }
  };
  exit.addEventListener('click', requestExit);
  routeButton.addEventListener('click', async () => {
    routeButton.disabled = true;
    routeButton.textContent = 'FOLLOWING SOURCE PTH → BWM…';
    try {
      const result = await runtime?.runExitRoute?.();
      state.diagnostics.exitRouteResult = result ?? { pass: false, reason: 'EBON_ROUTE_RUNNER_UNAVAILABLE' };
      if (!state.diagnostics.exitRouteResult.pass) metrics.errors.push(`EBON_EXIT_ROUTE: ${JSON.stringify(state.diagnostics.exitRouteResult)}`);
    } catch (error) {
      const result = { pass: false, reason: String(error) };
      state.diagnostics.exitRouteResult = result;
      metrics.errors.push(`EBON_EXIT_ROUTE: ${String(error)}`);
    } finally {
      routeButton.disabled = false;
      routeButton.textContent = 'DEV · WALK TO SOURCE EXIT';
      updateState();
    }
  });
  const runAnchorheadSmoke = async (mode: 'walk' | 'run', button: HTMLButtonElement) => {
    button.disabled = true;
    button.textContent = `ANCHORHEAD · ${mode.toUpperCase()} PTH TEST…`;
    try {
      const result = await win.__w236AnchorheadTest?.runPthSmoke(mode);
      state.diagnostics.anchorheadMovementSmoke[mode] = result ?? { pass: false, reason: 'ANCHORHEAD_PTH_SMOKE_UNAVAILABLE' };
      if (!state.diagnostics.anchorheadMovementSmoke[mode].pass) metrics.errors.push(`ANCHORHEAD_${mode.toUpperCase()}_SMOKE: ${JSON.stringify(state.diagnostics.anchorheadMovementSmoke[mode])}`);
    } catch (error) {
      state.diagnostics.anchorheadMovementSmoke[mode] = { pass: false, reason: String(error) };
      metrics.errors.push(`ANCHORHEAD_${mode.toUpperCase()}_SMOKE: ${String(error)}`);
    } finally {
      button.disabled = false;
      button.textContent = `ANCHORHEAD · ${mode.toUpperCase()} 20M`;
      updateState();
    }
  };
  walkButton.addEventListener('click', () => void runAnchorheadSmoke('walk', walkButton));
  runButton.addEventListener('click', () => void runAnchorheadSmoke('run', runButton));

  const cleanup = () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('keydown', onKey, true);
    window.clearInterval(poll);
    root.remove();
  };
  const poll = window.setInterval(() => { updateState(); }, 200);
  win.__w236VerticalSlice = {
    state: () => clone(state),
    exit: requestExit,
    toggleDebug: setDebug,
    runtime: () => runtime,
    resourceLog,
    metrics,
    dispose: cleanup,
  };

  const begin = async () => {
    const playableName = session.leaderId === 'jolee' ? 'Jolee' : 'Aren';
    setQuery({ ebonHawkLab: '1', playable: playableName, party: '1', partyPreset: session.partyPreset === 'belaya_donor' ? 'belaya' : null, kotorAnchorheadViewer: null });
    state.currentWorld = clone(W236_WORLD_DEFINITIONS.ebon_hawk_003ebo);
    session.currentWorldId = 'ebon_hawk_003ebo';
    setLifecycleState('LOAD_WORLD');
    const { startEbonHawkLab } = await import('./EbonHawkLab');
    runtime = await startEbonHawkLab({
      verticalSlice: true,
      companions: session.party.map((member) => member.id),
      onLifecycleState: setLifecycleState,
      onRuntimeCreated: (handle) => { runtime = handle; updateState(); },
    });
    metrics.ebonBefore = runtime.snapshot();
    resourceLog.push({ phase: 'EBON_READY', counts: metrics.ebonBefore });
    state.diagnostics.activeWorldCount = 1;
    updateState();
  };
  try {
    await begin();
  } catch (error) {
    metrics.errors.push(`EBON_LOAD_FAILED: ${error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)}`);
    setLifecycleState('FAILED');
    message.textContent = `EBON HAWK LOAD FAILED\n${error instanceof Error ? error.message : String(error)}`;
    message.style.opacity = '1';
    const failedRuntime = runtime as W236WorldRuntimeHandle | null;
    failedRuntime?.disposeActors(); failedRuntime?.disposeWorld(); runtime = null;
  }
  updateState();
  return { dispose: cleanup, requestExit, state: () => clone(state) } as any;
}
