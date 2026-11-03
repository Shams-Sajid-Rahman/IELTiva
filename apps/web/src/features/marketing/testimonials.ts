export type Testimonial = { quote: string; name: string; context: string };

/**
 * Add only real quotes, from real students, with their written permission. The section stays hidden while this
 * list is empty, so the site never shows invented praise.
 */
export const testimonials: Testimonial[] = [];
