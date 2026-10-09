import {
  Vector3,
} from '@babylonjs/core';

import { PlayerController } from '../player/PlayerController';

import {
  partyRoster,
} from '../party/PartyRoster';

type DialogueBeat = {
  speaker: string;
  text: string;
};

const FIRST_MEETING: DialogueBeat[] = [
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      'Jedi.',
  },
  {
    speaker:
      'AREN VEY',
    text:
      'Teniente Dane.',
  },
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      '¿Cuántos vienen detrás de ustedes?',
  },
  {
    speaker:
      'AREN VEY',
    text:
      'La Maestra Voss y yo fuimos asignados a la misión.',
  },
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      'Dos.',
  },
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      'Empiecen por los de la pared sur. Los de la pared norte pueden esperar.',
  },
  {
    speaker:
      'AREN VEY',
    text:
      'Después necesito que me muestres qué está pasando fuera del hospital.',
  },
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      'Voy con vos. Conozco Khepra y sé dónde dejaron de aparecer personas.',
  },
];

const AFTER_RECRUITMENT: DialogueBeat[] = [
  {
    speaker:
      'TENIENTE ELYRA DANE',
    text:
      'Decime cuándo nos movemos.',
  },
];

const STYLE_ID =
  'elyraRecruitmentDialogueStyle';

const OVERLAY_ID =
  'elyraRecruitmentDialogueOverlay';

function ensureStyles() {
  if (
    document.getElementById(
      STYLE_ID,
    )
  ) {
    return;
  }

  const style =
    document.createElement(
      'style',
    );

  style.id =
    STYLE_ID;

  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      inset: 0;
      z-index: 10050;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 0 24px 42px;
      background:
        linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.04) 0%,
          rgba(0, 0, 0, 0.10) 45%,
          rgba(0, 0, 0, 0.72) 100%
        );
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    #${OVERLAY_ID}[hidden] {
      display: none;
    }

    #${OVERLAY_ID} .elyra-dialogue-panel {
      width: min(920px, calc(100vw - 32px));
      min-height: 190px;
      border: 1px solid rgba(96, 214, 240, 0.48);
      border-radius: 12px;
      background: rgba(4, 13, 18, 0.96);
      box-shadow:
        0 20px 70px rgba(0, 0, 0, 0.58),
        inset 0 1px 0 rgba(255, 255, 255, 0.035);
      color: #e7f5f8;
      overflow: hidden;
    }

    #${OVERLAY_ID} .elyra-dialogue-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(96, 214, 240, 0.18);
      background: rgba(7, 29, 38, 0.72);
    }

    #${OVERLAY_ID} .elyra-dialogue-kicker {
      color: #77deef;
      font-family:
        "IBM Plex Mono",
        Consolas,
        monospace;
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    #${OVERLAY_ID} .elyra-dialogue-speaker {
      margin: 0;
      color: #ffffff;
      font-size: 18px;
      font-weight: 750;
      letter-spacing: 0.055em;
      text-transform: uppercase;
    }

    #${OVERLAY_ID} .elyra-dialogue-body {
      padding: 22px 20px 18px;
    }

    #${OVERLAY_ID} .elyra-dialogue-text {
      margin: 0;
      min-height: 58px;
      color: #e6ecee;
      font-size: 20px;
      line-height: 1.48;
    }

    #${OVERLAY_ID} .elyra-dialogue-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding-top: 20px;
    }

    #${OVERLAY_ID} button {
      min-width: 146px;
      border: 1px solid rgba(96, 214, 240, 0.48);
      border-radius: 8px;
      padding: 10px 16px;
      background: rgba(18, 54, 66, 0.78);
      color: #e8fbff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #${OVERLAY_ID} button:hover,
    #${OVERLAY_ID} button:focus-visible {
      background: rgba(26, 82, 98, 0.96);
      outline: none;
    }

    #${OVERLAY_ID} .elyra-dialogue-recruit {
      border-color: rgba(255, 194, 80, 0.72);
      background: rgba(87, 59, 13, 0.88);
      color: #fff2cb;
    }

    #elyraRecruitToast {
      position: fixed;
      left: 50%;
      top: 18%;
      z-index: 10080;
      transform: translateX(-50%);
      border: 1px solid rgba(255, 203, 107, 0.65);
      border-radius: 10px;
      padding: 14px 20px;
      background: rgba(6, 15, 20, 0.96);
      color: #ffe2a6;
      font-family:
        "IBM Plex Mono",
        Consolas,
        monospace;
      font-size: 14px;
      letter-spacing: 0.08em;
      box-shadow:
        0 16px 44px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
  `;

  document.head.appendChild(
    style,
  );
}

function showRecruitToast() {
  const previous =
    document.getElementById(
      'elyraRecruitToast',
    );

  previous?.remove();

  const toast =
    document.createElement(
      'div',
    );

  toast.id =
    'elyraRecruitToast';

  toast.textContent =
    'ELYRA DANE RECLUTADA · DISPONIBLE PARA EL GRUPO';

  document.body.appendChild(
    toast,
  );

  window.setTimeout(
    () => toast.remove(),
    2600,
  );
}

export class ElyraRecruitmentDialogue {
  private overlay?: HTMLDivElement;

  private speaker?: HTMLElement;

  private text?: HTMLElement;

  private nextButton?: HTMLButtonElement;

  private closeButton?: HTMLButtonElement;

  private beatIndex = 0;

  private active = false;

  private readonly keyHandler = (
    event: KeyboardEvent,
  ) => {
    if (
      !this.active
    ) {
      return;
    }

    if (
      event.key === 'Escape'
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.advance();
    }
  };

  constructor(
    private readonly player:
      PlayerController,

    private readonly elyraPosition:
      () => Vector3,
  ) {
    ensureStyles();
    this.buildUi();

    window.addEventListener(
      'keydown',
      this.keyHandler,
      true,
    );
  }

  open() {
    if (
      this.active
    ) {
      return;
    }

    this.active = true;
    this.beatIndex = 0;

    this.player.setActionLocked(
      true,
    );

    this.faceElyra();

    if (
      this.overlay
    ) {
      this.overlay.hidden =
        false;
    }

    this.renderBeat();
  }

  dispose() {
    this.close();

    window.removeEventListener(
      'keydown',
      this.keyHandler,
      true,
    );

    this.overlay?.remove();
    this.overlay =
      undefined;
  }

  private buildUi() {
    const overlay =
      document.createElement(
        'div',
      );

    overlay.id =
      OVERLAY_ID;

    overlay.hidden =
      true;

    overlay.innerHTML = `
      <section
        class="elyra-dialogue-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="elyraDialogueSpeaker"
      >
        <header class="elyra-dialogue-header">
          <div>
            <div class="elyra-dialogue-kicker">
              CLÍNICA 2 · KHEPRA VALE
            </div>
            <h2
              id="elyraDialogueSpeaker"
              class="elyra-dialogue-speaker"
            ></h2>
          </div>
        </header>

        <div class="elyra-dialogue-body">
          <p class="elyra-dialogue-text"></p>

          <div class="elyra-dialogue-actions">
            <button
              type="button"
              class="elyra-dialogue-close"
            >
              Salir
            </button>

            <button
              type="button"
              class="elyra-dialogue-next"
            >
              Continuar
            </button>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(
      overlay,
    );

    this.overlay =
      overlay;

    this.speaker =
      overlay.querySelector(
        '.elyra-dialogue-speaker',
      ) ?? undefined;

    this.text =
      overlay.querySelector(
        '.elyra-dialogue-text',
      ) ?? undefined;

    this.nextButton =
      overlay.querySelector<HTMLButtonElement>(
        '.elyra-dialogue-next',
      ) ?? undefined;

    this.closeButton =
      overlay.querySelector<HTMLButtonElement>(
        '.elyra-dialogue-close',
      ) ?? undefined;

    this.nextButton?.addEventListener(
      'click',
      () =>
        this.advance(),
    );

    this.closeButton?.addEventListener(
      'click',
      () =>
        this.close(),
    );
  }

  private currentBeats() {
    return partyRoster.isRecruited(
      'elyra_dane',
    )
      ? AFTER_RECRUITMENT
      : FIRST_MEETING;
  }

  private renderBeat() {
    const beats =
      this.currentBeats();

    const beat =
      beats[this.beatIndex];

    if (!beat) {
      this.finishConversation();
      return;
    }

    if (
      this.speaker
    ) {
      this.speaker.textContent =
        beat.speaker;
    }

    if (
      this.text
    ) {
      this.text.textContent =
        beat.text;
    }

    if (
      this.nextButton
    ) {
      const isLast =
        this.beatIndex ===
        beats.length - 1;

      const alreadyRecruited =
        partyRoster.isRecruited(
          'elyra_dane',
        );

      this.nextButton.textContent =
        isLast
          ? alreadyRecruited
            ? 'Cerrar'
            : 'Reclutar a Elyra'
          : 'Continuar';

      this.nextButton.classList.toggle(
        'elyra-dialogue-recruit',
        isLast &&
          !alreadyRecruited,
      );
    }
  }

  private advance() {
    if (
      !this.active
    ) {
      return;
    }

    const beats =
      this.currentBeats();

    const isLast =
      this.beatIndex >=
      beats.length - 1;

    if (isLast) {
      this.finishConversation();
      return;
    }

    this.beatIndex +=
      1;

    this.renderBeat();
  }

  private finishConversation() {
    if (
      !partyRoster.isRecruited(
        'elyra_dane',
      )
    ) {
      const recruited =
        partyRoster.recruit(
          'elyra_dane',
        );

      if (recruited) {
        showRecruitToast();
      }
    }

    this.close();
  }

  private close() {
    if (
      !this.active
    ) {
      return;
    }

    this.active =
      false;

    if (
      this.overlay
    ) {
      this.overlay.hidden =
        true;
    }

    this.player.setActionLocked(
      false,
    );
  }

  private faceElyra() {
    const delta =
      this.elyraPosition()
        .subtract(
          this.player.position,
        );

    if (
      delta.lengthSquared() <
      0.0001
    ) {
      return;
    }

    this.player.setFacingYaw(
      Math.atan2(
        delta.x,
        delta.z,
      ),
    );
  }
}
