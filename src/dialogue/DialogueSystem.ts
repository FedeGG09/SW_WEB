import { QuestSystem } from '../quests/QuestSystem';
import { partyRoster } from '../party/PartyRoster';

type DialogueChoice = {
  label: string;
  action: () => void;
};

/**
 * Nara Voss dialogue / first-party recruitment.
 *
 * Narrative source:
 * - keeps the mentor/student dynamic from the novel;
 * - preserves Nara's practical compassion and caution under pressure;
 * - the Twi'lek background is a GAME ADAPTATION layer, not a retcon of the
 *   novel's themes or of her relationship with Aren.
 */
export class DialogueSystem {
  private open = false;
  private awaitingFirstConversationFinish = false;

  private readonly overlay: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly text: HTMLElement;
  private readonly options: HTMLElement;

  constructor(
    private readonly quest: QuestSystem,
    private readonly onClosed: () => void,
  ) {
    this.overlay = document.getElementById('dialogueOverlay')!;
    this.speaker = document.getElementById('dialogueSpeaker')!;
    this.text = document.getElementById('dialogueText')!;
    this.options = document.getElementById('dialogueOptions')!;

    window.addEventListener(
      'keydown',
      this.onKeyDown,
      true,
    );
  }

  openNara() {
    if (this.open) return;

    this.open = true;
    this.awaitingFirstConversationFinish = false;
    this.speaker.textContent = 'NARA VOSS';
    this.overlay.classList.remove('is-hidden');

    if (partyRoster.isRecruited('nara_voss')) {
      this.renderCompanionConversation();
      return;
    }

    this.renderFirstMeeting();
  }

  /** W224 placeholder only; it never recruits or advances the Khepra quest. */
  openTatooinePlaceholder(kind: 'contact' | 'merchant') {
    if (this.open) return;
    this.open = true;
    this.awaitingFirstConversationFinish = false;
    this.speaker.textContent = kind === 'contact' ? 'Contacto de Tatooine' : 'Comerciante Jawa';
    this.text.textContent = kind === 'contact'
      ? 'El camino del desierto pasa por un checkpoint y un campamento. Este diálogo es provisional.'
      : 'Utinni. El comercio de este poblado está en preparación.';
    this.overlay.classList.remove('is-hidden');
    this.setChoices([{ label: 'Volver al juego', action: () => this.close() }]);
  }

  private renderFirstMeeting() {
    this.speaker.textContent = 'NARA VOSS';
    this.text.textContent =
      'Esperabas ver la guerra desde arriba. Khepra Vale va a enseñarte que la distancia vuelve simples cosas que no lo son. Vamos a bajar, ayudar primero y entender después.';

    this.setChoices([
      {
        label: '¿Qué sabemos de Khepra Vale?',
        action: () => this.renderFirstAnswer('khepra'),
      },
      {
        label: '¿Por qué sólo nosotros?',
        action: () => this.renderFirstAnswer('council'),
      },
      {
        label: '¿Qué querés que haga?',
        action: () => this.renderFirstAnswer('lesson'),
      },
    ]);
  }

  private renderFirstAnswer(
    branch: 'khepra' | 'council' | 'lesson',
  ) {
    if (branch === 'khepra') {
      this.text.textContent =
        'El puerto está dañado, hay miles de heridos y las comunicaciones son fragmentarias. No empieces buscando una batalla. Mirá quién necesita agua, una venda o una salida. Después hablamos de enemigos.';
    }

    if (branch === 'council') {
      this.text.textContent =
        'La Orden nos envió como misión humanitaria. Eso no significa que el Consejo comprenda todo lo que ocurre aquí. Tampoco significa que nosotros tengamos derecho a convertir cada duda en una guerra.';
    }

    if (branch === 'lesson') {
      this.text.textContent =
        'Quiero que mires antes de decidir. Tener poder no significa que puedas salvar a todos, y actuar más no siempre significa actuar mejor. Si alguien depende de tu decisión, la intención deja de ser suficiente.';
    }

    this.awaitingFirstConversationFinish = true;

    this.setChoices([
      {
        label: 'Entendido. Vamos juntos.',
        action: () => this.finishFirstConversation(),
      },
      {
        label: 'Quiero preguntarte otra cosa.',
        action: () => {
          this.awaitingFirstConversationFinish = false;
          this.renderFirstMeeting();
        },
      },
    ]);
  }

  private finishFirstConversation() {
    this.quest.completeNaraConversation();

    const recruited =
      partyRoster.recruit('nara_voss');

    if (recruited) {
      this.showRecruitToast();
    }

    this.close();
  }

  private renderCompanionConversation() {
    this.speaker.textContent = 'NARA VOSS';
    this.text.textContent =
      'No hace falta que me llames Maestra cada vez que querés preguntar algo. Decilo.';

    this.setChoices([
      {
        label: 'Contame algo de Ryloth.',
        action: () => {
          this.text.textContent =
            'Recuerdo más el movimiento que los lugares: gente aprendiendo cuándo quedarse, cuándo ocultarse y cuándo irse. La Orden me dio otra vida, pero nunca consiguió convencerme de que sobrevivir y vencer fueran la misma cosa.';
          this.renderReturnChoice();
        },
      },
      {
        label: 'Nunca hablás de tu pasado.',
        action: () => {
          this.text.textContent =
            'Todos dejamos a alguien atrás, Aren. La diferencia está en si aprendemos de esa decisión o construimos una historia para no mirarla. Algún día te contaré la mía. Hoy no la necesitás para hacer lo correcto.';
          this.renderReturnChoice();
        },
      },
      {
        label: '¿Todavía creés que debemos esperar?',
        action: () => {
          this.text.textContent =
            'No defiendo esperar por obediencia. Defiendo conservar la posibilidad de detener esto sin convertirnos en aquello que queremos derrotar. Si mañana la respuesta cambia, cambiaremos con ella.';
          this.renderReturnChoice();
        },
      },
      {
        label: 'Nada por ahora.',
        action: () => this.close(),
      },
    ]);
  }

  private renderReturnChoice() {
    this.setChoices([
      {
        label: 'Seguir hablando.',
        action: () => this.renderCompanionConversation(),
      },
      {
        label: 'Volver al juego.',
        action: () => this.close(),
      },
    ]);
  }

  private setChoices(
    choices: DialogueChoice[],
  ) {
    this.options.innerHTML = '';

    choices.forEach(
      (choice, index) => {
        const button =
          document.createElement('button');

        button.type = 'button';
        button.textContent =
          `${index + 1}. ${choice.label}`;

        button.addEventListener(
          'click',
          choice.action,
        );

        this.options.appendChild(button);
      },
    );
  }

  private showRecruitToast() {
    document
      .getElementById('naraRecruitToast')
      ?.remove();

    const toast =
      document.createElement('div');

    toast.id = 'naraRecruitToast';
    toast.textContent =
      'NARA VOSS RECLUTADA · MAESTRA JEDI · SABLE VERDE';

    Object.assign(
      toast.style,
      {
        position: 'fixed',
        left: '50%',
        top: '18%',
        zIndex: '10080',
        transform: 'translateX(-50%)',
        border: '1px solid rgba(113, 240, 139, 0.72)',
        borderRadius: '10px',
        padding: '14px 20px',
        background: 'rgba(6, 15, 20, 0.96)',
        color: '#caffd5',
        fontFamily: 'IBM Plex Mono, Consolas, monospace',
        fontSize: '14px',
        letterSpacing: '0.08em',
        boxShadow: '0 16px 44px rgba(0, 0, 0, 0.45)',
        pointerEvents: 'none',
      },
    );

    document.body.appendChild(toast);

    window.setTimeout(
      () => toast.remove(),
      2800,
    );
  }

  private readonly onKeyDown = (
    event: KeyboardEvent,
  ) => {
    if (!this.open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    const choice = Number(event.key);

    if (
      choice < 1 ||
      choice > this.options.children.length
    ) {
      return;
    }

    const button =
      this.options.children[
        choice - 1
      ] as HTMLButtonElement | undefined;

    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    button.click();
  };

  private close() {
    if (!this.open) return;

    this.open = false;
    this.awaitingFirstConversationFinish = false;
    this.overlay.classList.add('is-hidden');
    this.onClosed();
  }

  get isOpen() {
    return this.open;
  }
}
