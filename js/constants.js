// Fixed list of the ten voting categories. IDs are also hard-coded in firestore.rules.
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
];

// Student accounts are Firebase Auth email/password users whose "email" is
// <voterCode>@<EMAIL_DOMAIN>. The domain is never used to send mail.
export const EMAIL_DOMAIN = "voters.maranatha.school";

export const SCHOOL = "MARANATHA GIRLS ACADEMY";
export const SYSTEM = "ONLINE PREFECT ELECTION SYSTEM";
export const MOTTO = "Your Voice, Your Choice, Your Leadership.";
