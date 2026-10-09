import type { AcademyNpcInstance } from '../../world/AcademyNpcPopulation';

/**
 * Isolated interaction prototype for the source-backed Belaya NPC.
 *
 * No quest/global mutations, no VO/LIP, no party/combat ownership, and no
 * changes to the shared AcademyNpcPopulation animation policy.
 *
 * Dialogue text is NEW playtest copy, not a transcription of KOTOR's DLG.
 */
export const BELAYA_SOURCE_NPC_ID = 'danm13:dan13_belaya:1';

type Choice = { label: string; action: () => void };

export class BelayaDialogueV1 {
  private readonly backdrop: HTMLDivElement;
  private readonly speech: HTMLParagraphElement;
  private readonly choices: HTMLDivElement;
  private readonly diagnostic: HTMLDivElement;
  private actor: AcademyNpcInstance | null = null;
  private previousFocus: HTMLElement | null = null;
  private clip = 'NONE';
  private dialogueNode = 'CLOSED';
  private readonly keyHandler = (event: KeyboardEvent): void => {
    if (!this.actor) return;
    // Capture game hotkeys (including movement / tactical commands) while the
    // dialogue is open. Keyup is deliberately not blocked, so input owners can
    // release any already-held keys.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      this.close();
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const button = this.choices.querySelectorAll('button')[Number(event.key) - 1];
      button?.click();
    }
  };

  constructor() {
    this.backdrop = document.createElement('div');
    this.backdrop.id = 'belayaDialogueV1';
    this.backdrop.hidden = true;
    this.backdrop.setAttribute('role', 'dialog');
    this.backdrop.setAttribute('aria-modal', 'true');
    this.backdrop.setAttribute('aria-label', 'Conversación con Belaya');
    this.backdrop.tabIndex = -1;
    this.backdrop.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:10050',
      'display:none', 'align-items:flex-end', 'justify-content:center',
      'padding:20px', 'box-sizing:border-box',
      'background:linear-gradient(transparent 30%,rgba(5,9,16,.66))',
      'color:#eee8dc', 'font:15px/1.5 system-ui,sans-serif',
    ].join(';');

    const panel = document.createElement('section');
    panel.style.cssText = [
      'width:min(800px,100%)', 'padding:20px', 'box-sizing:border-box',
      'background:rgba(12,19,29,.97)', 'border:1px solid #a28a63',
      'border-radius:10px', 'box-shadow:0 22px 55px rgba(0,0,0,.65)',
    ].join(';');

    const heading = document.createElement('h2');
    heading.textContent = 'BELAYA';
    heading.style.cssText = 'font-size:19px;margin:0 0 6px;color:#e7c68e;letter-spacing:.12em';
    panel.appendChild(heading);

    this.speech = document.createElement('p');
    this.speech.id = 'belayaDialogueText';
    this.speech.style.cssText = 'min-height:52px;margin:10px 0 14px';
    panel.appendChild(this.speech);

    this.choices = document.createElement('div');
    this.choices.id = 'belayaDialogueChoices';
    this.choices.style.cssText = 'display:grid;gap:8px';
    panel.appendChild(this.choices);

    this.diagnostic = document.createElement('div');
    this.diagnostic.style.cssText = 'font:10px/1.3 monospace;color:#8796a6;margin-top:12px';
    this.diagnostic.textContent = 'NPC V1 · DIÁLOGO PROVISIONAL · SIN VO/LIP';
    panel.appendChild(this.diagnostic);

    this.backdrop.appendChild(panel);
    document.body.appendChild(this.backdrop);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  get isOpen(): boolean {
    return this.actor !== null;
  }

  open(instance: AcademyNpcInstance): boolean {
    if (this.actor || instance.record.stableNpcId !== BELAYA_SOURCE_NPC_ID || !instance.root.isEnabled()) {
      return false;
    }
    this.actor = instance;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.backdrop.hidden = false;
    this.backdrop.style.display = 'flex';
    this.renderGreeting();
    this.backdrop.focus();
    return true;
  }

  private play(name: string): void {
    if (!this.actor) return;
    const groups = this.actor.asset.animationGroups;
    const group = groups.find(candidate => candidate.name.trim().toLowerCase() === name.toLowerCase());
    if (!group) {
      this.clip = 'MISSING:' + name;
      return;
    }
    for (const animation of groups) animation.stop();
    group.start(true, 1);
    this.actor.activeAnimation = group.name;
    this.clip = group.name;
  }

  private render(text: string, node: string, choices: Choice[]): void {
    this.dialogueNode = node;
    this.speech.textContent = text;
    this.choices.replaceChildren();
    choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(index + 1) + '. ' + choice.label;
      button.style.cssText = [
        'background:#1b2b3b', 'color:#f0e9dc', 'border:1px solid #4d6275',
        'padding:10px 12px', 'text-align:left', 'border-radius:5px',
        'cursor:pointer', 'font:inherit',
      ].join(';');
      button.addEventListener('click', choice.action);
      this.choices.appendChild(button);
    });
    this.diagnostic.textContent = 'NPC V1 · ' + node + ' · CLIP ' + this.clip + ' · TEXTO DE PRUEBA';
  }

  private renderGreeting(): void {
    this.play('talk');
    this.render(
      'Bienvenido al Enclave. La paciencia es tan importante como la destreza con un sable de luz.',
      'GREETING',
      [
        { label: '¿Qué se espera de un Padawan?', action: () => this.renderAnswer(
          'Una mente atenta y la voluntad de aprender. No todo desafío se resuelve luchando.',
          'TRAINING',
        ) },
        { label: '¿Conocés a Juhani?', action: () => this.renderAnswer(
          'La conozco. Es una Jedi apasionada, y su camino merece ser escuchado con respeto.',
          'JUHANI',
        ) },
        { label: 'Hasta luego, Belaya.', action: () => this.close() },
      ],
    );
  }

  private renderAnswer(text: string, node: string): void {
    this.play('talk');
    this.render(text, node, [
      { label: 'Tengo otra pregunta.', action: () => this.renderGreeting() },
      { label: 'Gracias por hablar conmigo.', action: () => this.close() },
    ]);
  }

  close(): void {
    if (!this.actor) return;
    this.play('pause1');
    this.actor = null;
    this.dialogueNode = 'CLOSED';
    this.backdrop.hidden = true;
    this.backdrop.style.display = 'none';
    this.previousFocus?.focus();
    this.previousFocus = null;
  }

  snapshot() {
    return {
      open: this.isOpen,
      stableNpcId: this.actor?.record.stableNpcId ?? null,
      dialogueNode: this.dialogueNode,
      activeAnimation: this.actor?.activeAnimation ?? this.clip,
      voice: 'NOT_IMPLEMENTED',
      lipSync: 'NOT_IMPLEMENTED',
      sourceDialogue: 'PLAYTEST_ONLY',
    };
  }

  dispose(): void {
    this.close();
    window.removeEventListener('keydown', this.keyHandler, true);
    this.backdrop.remove();
  }
}
