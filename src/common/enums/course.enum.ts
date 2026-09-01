/** Course providers the recommender is allowed to source from. */
export enum CourseProvider {
  UDEMY = 'udemy',
  COURSERA = 'coursera',
}

/**
 * How a course is billed, which decides what the UI can honestly say about cost.
 *
 * ONE_TIME courses have a single purchase price. SUBSCRIPTION courses (Coursera
 * Specializations) bill monthly, so total cost depends on how long the learner
 * takes — there is no single number to show, and this is where the 3-token cap
 * actually bites.
 */
export enum CoursePricingModel {
  ONE_TIME = 'one_time',
  SUBSCRIPTION = 'subscription',
}
