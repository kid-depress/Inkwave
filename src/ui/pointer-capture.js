import { h } from './ui-util.js';

// A network message can start a round without a user gesture. Keep a visible way to
// acquire the mouse whenever that automatic pointer-lock request is refused.
export class PointerCapture {
  constructor(input, root, canCapture) {
    this.input = input;
    this.canCapture = canCapture;
    this.el = h('button', { class: 'iw-pointer-capture', type: 'button', hidden: true },
      h('strong', { text: 'Click to aim' }),
      h('span', { text: 'Click here to capture the mouse. Press Esc to open the menu.' }));
    this.el.addEventListener('mousedown', (event) => event.stopPropagation());
    this.el.addEventListener('click', (event) => {
      event.stopPropagation();
      this.capture();
    });
    root.appendChild(this.el);
    input.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.capture();
    });
    document.addEventListener('pointerlockchange', () => this.update());
  }

  capture() {
    if (!this.canCapture() || this.input.locked) return;
    this.input.lastDevice = 'kbm';
    this.input.requestLock();
  }

  update() {
    this.el.hidden = !this.canCapture() || this.input.locked ||
      (this.input.pad && this.input.lastDevice === 'pad');
  }
}
