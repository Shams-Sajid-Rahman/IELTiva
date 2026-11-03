/**
 * Removes obvious personal details from free text before it goes to an AI provider, because the tutor never needs them.
 * It's a safeguard for accidents, and it won't catch everything, such as names, so the consent wording remains what students rely on.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone-like runs of 8 to 15 digits, with common separators. Years and short numbers are too short to match.
const PHONE = /(?<![\w.])\+?\d(?:[\s().-]?\d){7,14}(?![\w.])/g;
const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

export function redactPersonalDetails(text: string) {
  return text.replace(EMAIL, "[email removed]").replace(CARD, "[number removed]").replace(PHONE, "[number removed]");
}
