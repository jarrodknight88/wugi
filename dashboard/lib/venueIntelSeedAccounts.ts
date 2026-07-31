// Current Apify seed list (hardcoded for v1 — see venue-intel issue).
// Any sourceAccount present in venueIntel that ISN'T in this list is a
// "discovered" candidate account surfaced for PM review.
export const VENUE_INTEL_SEED_ACCOUNTS = [
  "officialopiumatlanta",
  "revelatlanta",
  "tabuatlanta",
  "teranga.atl",
  "babaskitchenatl",
  "midtownsocialatl",
  "districtatlanta",
  "domaineatl",
  "rocksteadyatlanta",
  "bambooatlanta",
  "vibesatl",
  "atlpics",
  "chuckyfoto",
  "embrloungeatlanta",
  "lokeeatl",
] as const

export const VENUE_INTEL_SEED_ACCOUNTS_SET = new Set<string>(
  VENUE_INTEL_SEED_ACCOUNTS.map(a => a.toLowerCase())
)
