// @ts-nocheck — thin wiring shell; type checking focuses on the pure logic files.
/**
 * Localises the popup and options markup.
 *
 * The HTML keeps its English text inline, so the pages read normally and still
 * work if a catalogue is missing; this replaces it with the localised string
 * where one exists. Classic script, loaded after constants.js.
 */
(function attachI18n(global) {
  const { t } = global.MindfulScroll;

  /**
   * `data-i18n` sets textContent, `data-i18n-title` sets the title attribute.
   * @param {ParentNode} [root]
   */
  function applyI18n(root = document) {
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = t(element.dataset.i18n, element.textContent);
    }
    for (const element of root.querySelectorAll('[data-i18n-title]')) {
      element.title = t(element.dataset.i18nTitle, element.title);
    }
  }

  global.MindfulScroll.applyI18n = applyI18n;
  applyI18n();
})(window);
