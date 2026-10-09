import {
  PlayerController,
} from '../player/PlayerController';

import {
  PartyController,
} from './PartyController';

import {
  PartyCharacterId,
  PARTY_CHARACTER_LABELS,
} from './PartyRoster';

const STYLE_ID =
  'nerathisPartyPauseStyle';

const ROOT_ID =
  'nerathisPartyPauseMenu';

function dialogueIsOpen() {
  const overlays = [
    document.getElementById(
      'elyraRecruitmentDialogueOverlay',
    ),
    document.getElementById(
      'dialogueOverlay',
    ),
  ];

  return overlays.some(
    (element) =>
      element &&
      !element.hidden &&
      !element.classList.contains(
        'is-hidden',
      ),
  );
}

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
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 11000;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(
          circle at 50% 38%,
          rgba(18, 51, 65, 0.34),
          rgba(0, 0, 0, 0.84) 68%
        );
      color: #e8f5f8;
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        sans-serif;
    }

    #${ROOT_ID}[hidden] {
      display: none;
    }

    #${ROOT_ID} .party-pause__panel {
      width: min(1040px, calc(100vw - 32px));
      border: 1px solid rgba(103, 218, 239, 0.45);
      border-radius: 14px;
      background: rgba(4, 13, 18, 0.97);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.62);
      overflow: hidden;
    }

    #${ROOT_ID} .party-pause__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 20px 24px;
      border-bottom: 1px solid rgba(103, 218, 239, 0.16);
      background: rgba(7, 28, 38, 0.8);
    }

    #${ROOT_ID} h2 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    #${ROOT_ID} .party-pause__subtitle,
    #${ROOT_ID} .party-pause__hint {
      color: #9db6bd;
      font-family:
        "IBM Plex Mono",
        Consolas,
        monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    #${ROOT_ID} .party-pause__body {
      padding: 22px 24px 24px;
    }

    #${ROOT_ID} .party-pause__grid {
      display: grid;
      grid-template-columns:
        repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    #${ROOT_ID} .party-card {
      min-height: 210px;
      border: 1px solid rgba(125, 169, 181, 0.24);
      border-radius: 11px;
      padding: 18px;
      background: rgba(11, 27, 34, 0.92);
    }

    #${ROOT_ID} .party-card.is-active {
      border-color: rgba(105, 221, 241, 0.78);
      box-shadow: inset 0 0 0 1px rgba(105, 221, 241, 0.18);
    }

    #${ROOT_ID} .party-card.is-companion {
      border-color: rgba(255, 201, 97, 0.5);
    }

    #${ROOT_ID} .party-card__status {
      margin-bottom: 12px;
      color: #76dfee;
      font-family:
        "IBM Plex Mono",
        Consolas,
        monospace;
      font-size: 11px;
      letter-spacing: 0.12em;
    }

    #${ROOT_ID} .party-card__name {
      margin: 0 0 6px;
      font-size: 19px;
    }

    #${ROOT_ID} .party-card__role {
      min-height: 44px;
      color: #9fb0b6;
      font-size: 13px;
      line-height: 1.45;
    }

    #${ROOT_ID} .party-card__actions {
      display: grid;
      gap: 8px;
      margin-top: 18px;
    }

    #${ROOT_ID} button {
      border: 1px solid rgba(103, 218, 239, 0.42);
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(19, 54, 65, 0.86);
      color: #eefcff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #${ROOT_ID} button:hover,
    #${ROOT_ID} button:focus-visible {
      background: rgba(29, 82, 98, 0.96);
      outline: none;
    }

    #${ROOT_ID} button.is-selected {
      border-color: rgba(255, 201, 97, 0.72);
      background: rgba(81, 57, 16, 0.92);
      color: #fff0c8;
    }

    #${ROOT_ID} button:disabled {
      opacity: 0.42;
      cursor: default;
    }

    #${ROOT_ID} .party-pause__footer {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid rgba(103, 218, 239, 0.14);
    }

    #${ROOT_ID} .party-pause__close {
      min-width: 160px;
    }

    @media (max-width: 760px) {
      #${ROOT_ID} {
        padding: 12px;
      }

      #${ROOT_ID} .party-pause__grid {
        grid-template-columns: 1fr;
      }

      #${ROOT_ID} .party-card {
        min-height: 0;
      }
    }
  `;

  document.head.appendChild(
    style,
  );
}

export class PartyPauseMenu {
  private readonly root:
    HTMLDivElement;

  private readonly grid:
    HTMLDivElement;

  private openState =
    false;

  private readonly keyHandler =
    (
      event:
        KeyboardEvent,
    ) => {
      if (
        event.repeat
      ) {
        return;
      }

      if (
        event.key ===
        'Escape'
      ) {
        if (
          dialogueIsOpen()
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (
          this.openState
        ) {
          this.close();
        } else {
          this.open();
        }

        return;
      }

      if (
        event.key ===
          'Tab' &&
        !this.openState &&
        !dialogueIsOpen()
      ) {
        event.preventDefault();

        void this.party
          .cycleActive();
      }
    };

  private readonly layoutHandler =
    () => {
      if (
        this.openState
      ) {
        this.render();
      }
    };

  constructor(
    private readonly player:
      PlayerController,

    private readonly party:
      PartyController,
  ) {
    ensureStyles();

    document.getElementById(
      ROOT_ID,
    )?.remove();

    this.root =
      document.createElement(
        'div',
      );

    this.root.id =
      ROOT_ID;

    this.root.hidden =
      true;

    this.root.innerHTML = `
      <section
        class="party-pause__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menú de pausa y grupo"
      >
        <header class="party-pause__header">
          <div>
            <div class="party-pause__subtitle">
              NERATHIS · PAUSA
            </div>
            <h2>Grupo</h2>
          </div>

          <div class="party-pause__hint">
            1 principal + hasta 2 acompañantes<br>
            TAB: cambio rápido
          </div>
        </header>

        <div class="party-pause__body">
          <div class="party-pause__grid"></div>

          <div class="party-pause__footer">
            <div class="party-pause__hint">
              El personaje principal recibe el control directo.
              Los demás integrantes seleccionados siguen físicamente al líder.
            </div>

            <button
              type="button"
              class="party-pause__close"
            >
              Volver al juego
            </button>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(
      this.root,
    );

    const grid =
      this.root.querySelector<HTMLDivElement>(
        '.party-pause__grid',
      );

    if (!grid) {
      throw new Error(
        'Party pause grid could not be created',
      );
    }

    this.grid =
      grid;

    this.root
      .querySelector(
        '.party-pause__close',
      )
      ?.addEventListener(
        'click',
        () =>
          this.close(),
      );

    window.addEventListener(
      'keydown',
      this.keyHandler,
      true,
    );

    window.addEventListener(
      'nerathis:party-layout-changed',
      this.layoutHandler,
    );

    window.addEventListener(
      'nerathis:party-recruited',
      this.layoutHandler,
    );
  }

  open() {
    if (
      this.openState ||
      dialogueIsOpen()
    ) {
      return;
    }

    this.openState =
      true;

    this.player.setActionLocked(
      true,
    );

    this.render();

    this.root.hidden =
      false;
  }

  close() {
    if (
      !this.openState
    ) {
      return;
    }

    this.openState =
      false;

    this.root.hidden =
      true;

    this.player.setActionLocked(
      false,
    );
  }

  dispose() {
    window.removeEventListener(
      'keydown',
      this.keyHandler,
      true,
    );

    window.removeEventListener(
      'nerathis:party-layout-changed',
      this.layoutHandler,
    );

    window.removeEventListener(
      'nerathis:party-recruited',
      this.layoutHandler,
    );

    this.root.remove();
  }

  private render() {
    const recruited =
      this.party.recruited;

    this.grid.innerHTML =
      '';

    const slots:
      Array<
        PartyCharacterId |
        undefined
      > = [
        ...recruited,
      ];

    while (
      slots.length < 3
    ) {
      slots.push(
        undefined,
      );
    }

    for (
      const id
      of slots.slice(
        0,
        3,
      )
    ) {
      if (!id) {
        this.grid.appendChild(
          this.createLockedCard(),
        );

        continue;
      }

      this.grid.appendChild(
        this.createCharacterCard(
          id,
        ),
      );
    }
  }

  private createLockedCard() {
    const card =
      document.createElement(
        'article',
      );

    card.className =
      'party-card';

    card.innerHTML = `
      <div class="party-card__status">
        RANURA DISPONIBLE
      </div>

      <h3 class="party-card__name">
        —
      </h3>

      <div class="party-card__role">
        Podrá ocuparse cuando reclutes otro integrante.
      </div>
    `;

    return card;
  }

  private createCharacterCard(
    id: PartyCharacterId,
  ) {
    const active =
      this.party.activeId ===
      id;

    const companion =
      this.party.isCompanion(
        id,
      );

    const card =
      document.createElement(
        'article',
      );

    card.className =
      [
        'party-card',
        active
          ? 'is-active'
          : '',
        companion
          ? 'is-companion'
          : '',
      ]
        .filter(Boolean)
        .join(' ');

    const status =
      active
        ? 'PRINCIPAL · CONTROL DIRECTO'
        : companion
          ? 'ACOMPAÑANTE · SIGUE AL GRUPO'
          : 'RECLUTADO · RESERVA';

    const role =
      id === 'aren_vey'
        ? 'Padawan Jedi · sable de luz'
        : id === 'nara_voss'
          ? "Maestra Jedi Twi'lek · sable de luz verde"
          : 'Oficial de la República · bláster E-11';

    card.innerHTML = `
      <div class="party-card__status">
        ${status}
      </div>

      <h3 class="party-card__name">
        ${PARTY_CHARACTER_LABELS[id]}
      </h3>

      <div class="party-card__role">
        ${role}
      </div>

      <div class="party-card__actions">
        <button
          type="button"
          class="party-card__principal ${active ? 'is-selected' : ''}"
          ${active ? 'disabled' : ''}
        >
          ${active ? 'Personaje principal' : 'Controlar'}
        </button>

        <button
          type="button"
          class="party-card__companion ${companion ? 'is-selected' : ''}"
          ${active ? 'disabled' : ''}
        >
          ${
            companion
              ? 'Quitar acompañante'
              : 'Usar como acompañante'
          }
        </button>
      </div>
    `;

    card
      .querySelector(
        '.party-card__principal',
      )
      ?.addEventListener(
        'click',
        () =>
          void this.party.setActive(
            id,
          ),
      );

    card
      .querySelector(
        '.party-card__companion',
      )
      ?.addEventListener(
        'click',
        () =>
          this.party.toggleCompanion(
            id,
          ),
      );

    return card;
  }
}
