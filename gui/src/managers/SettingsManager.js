const THEMES = Object.freeze({
  green: '#a4f56b',
  purple: '#b28cff',
  blue: '#68b8ff',
  orange: '#ffae62',
});

class SettingsManager {
  static async create(options = {}) {
    const { default: Store } = await import('electron-store');
    return new SettingsManager(new Store(options));
  }

  constructor(store) {
    this.store = store;
  }

  getTheme() {
    const theme = this.store.get('theme', 'green');
    return Object.hasOwn(THEMES, theme) ? theme : 'green';
  }

  setTheme(theme) {
    if (!Object.hasOwn(THEMES, theme)) {
      throw new TypeError('Tema selecionado inválido.');
    }
    this.store.set('theme', theme);
    return theme;
  }
}

module.exports = { SettingsManager, THEMES };
