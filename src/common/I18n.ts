const FALLBACK_LOCALE = "en";

class I18n {
  private locale: string;
  private translations: Record<string, Record<string, string>>;

  constructor({
    locale,
    translations,
  }: {
    locale?: string | undefined;
    translations: Record<string, Record<string, string>>;
  }) {
    this.locale = locale ?? FALLBACK_LOCALE;
    this.translations = translations;
  }

  t(str: string): string {
    if (!this.translations[str]) {
      throw new Error(`${str} Translation string not found`);
    }

    if (!this.translations[str]![this.locale]) {
      throw new Error(`'${str}' translation not found for locale '${this.locale}'`);
    }

    return this.translations[str]![this.locale]!;
  }
}

export { I18n };
export default I18n;
