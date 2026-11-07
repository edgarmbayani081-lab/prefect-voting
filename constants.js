// Fixed list of the fifteen voting categories. IDs are also hard-coded in firestore.rules.
export const POSITIONS = [
  { id: "head",          title: "HEAD GIRL" },
  { id: "vice",          title: "VICE HEAD GIRL" },
  { id: "health",        title: "HEALTH PREFECT" },
  { id: "sanitation",    title: "SANITATION PREFECT" },
  { id: "dining",        title: "DINING PREFECTS" },
  { id: "tuckshop",      title: "TUCKSHOP PREFECT" },
  { id: "entertainment", title: "ENTERTAINMENT PREFECT" },
  { id: "library",       title: "LIBRARY PREFECT" },
  { id: "english",       title: "ENGLISH PREFECT" },
  { id: "dormitory",     title: "DORMITORY PREFECT" },
  { id: "chapel",        title: "CHAPEL PREFECT" },
  { id: "maintenance",   title: "MAINTENANCE PREFECT" },
  { id: "timekeeper",    title: "TIMEKEEPER PREFECT" },
  { id: "studycircles",  title: "STUDY CIRCLES PREFECT" },
  { id: "sports",        title: "SPORTS PREFECT" },
];

// How many winners each position has. Head Girl and Vice Head Girl: 1. Dining Prefects: 3 (editable in the
// Election tab before voting opens). Every other position: 2. Each voter still chooses one candidate for these.
export const SEATS = { head: 1, vice: 1 };
export const DEFAULT_SEATS = 2;
export const DINING_SEATS = 3;
export const seatsFor = (id) => SEATS[id] ?? DEFAULT_SEATS;

// Student accounts are Firebase Auth email/password users whose "email" is
// <voterCode>@<EMAIL_DOMAIN>. The domain is never used to send mail.
export const EMAIL_DOMAIN = "voters.maranatha.school";

export const SCHOOL = "MARANATHA GIRLS ACADEMY";
export const SYSTEM = "ONLINE PREFECT ELECTION SYSTEM";
export const MOTTO = "Your Voice, Your Choice, Your Leadership.";
