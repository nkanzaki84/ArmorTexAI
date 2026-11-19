/**
 * ArmorTex Outreach — Config.gs
 * Constants, tab names, column headers, enums, settings keys, roles.
 * Same layout as SFM Job Manager's Config.gs so the two apps can share code.
 *
 * Edit this file when renaming a tab, adding a column, adding an enum value,
 * or changing a default setting. Then run setup() once — it appends any new
 * columns to the right of existing ones and never reorders.
 */

// ===== App version (bump on every /exec deploy; shows in the footer) =====
const APP_VERSION    = '0.1.0';
const APP_BUILD_DATE = '2026-11-19';

// ===== Script Property keys =====
const PROP_SHEET_ID = 'OUTREACH_SHEET_ID';
const PROP_LAST_REPLY_CHECK = 'OUTREACH_LAST_REPLY_CHECK';   // unix seconds

// ===== Sending behaviour =====
const REPLY_CHECK_MINUTES = 15;          // time-driven trigger cadence
const SEND_PAUSE_MS = [1500, 4000];      // random pause between sends
const REPLY_LOOKBACK_DAYS = 45;          // how far back the reply check searches
// Opt-out wording, any of these in a reply → do-not-contact + flagged for review.
const OPT_OUT_RE = /\b(no thanks|no thank you|unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|opt out|don't email|do not email|not interested)\b/i;
// Looks like a street address → suggest "Sent an address" for a person to confirm.
const ADDRESS_RE = /\b\d{2,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9][A-Za-z0-9.'\- ]{1,40}?\s(?:St|Street|Dr|Drive|Rd|Road|Ln|Lane|Ave|Avenue|Ct|Court|Cir|Circle|Blvd|Boulevard|Way|Trail|Trl|Pl|Place|Loop|Pkwy|Parkway|Hwy|Highway|Cv|Cove|Ter|Terrace|FM\s?\d+|CR\s?\d+)\b\.?/i;
// Bounce senders / subjects.
const BOUNCE_FROM_RE = /mailer-daemon|postmaster|noreply@google\.com/i;
const BOUNCE_SUBJECT_RE = /delivery status notification|undeliverable|delivery (has )?failed|returned mail|failure notice/i;

// ===== Master sheet =====
const SHEET_NAME = 'ArmorTex Outreach';

// ===== Owner (implicit owner role even if the Users tab is empty) =====
const OWNER_EMAIL = 'brian@armortexroofs.com';

// ===== Tab names =====
const TAB = {
  PARTNERS:  'Partners',
  HOMES:     'Homes',
  EMAILS:    'Emails',
  EVENTS:    'Events',
  REFERRALS: 'Referrals',
  VERSIONS:  'Versions',
  SETTINGS:  'Settings',
  USERS:     'Users',
  COMMENTS:  'Comments',   // pinned comments on pages (developer tool, from SFM)
};

// ===== ID prefixes (IDs are "P-12", "H-340", … readable in the Sheet) =====
const ID_PREFIX = {
  'Partners':  'P',
  'Homes':     'H',
  'Emails':    'E',
  'Events':    'EV',
  'Referrals': 'R',
  'Comments':  'C',
};

// ===== Column headers per tab. Order matters for new tabs; existing tabs are
// read/written by header NAME, and setup() only ever appends. =====
const HEADERS = {
  'Partners': [
    'ID',
    'Name',
    'Type',              // realtor | inspector | insurance | property_manager
    'Company',
    'Phone',
    'Email',
    'Area',
    'Stage',             // Prospect | Contacted | Replied | Partner  (derived; cached here)
    'Version',           // A | B | C | E — assigned once, never changed
    'Response',          // '' | Replied | Sent an address | Not interested | Bounced | Opted out (derived; cached)
    'Do Not Contact',    // Yes | ''
    'Last Contact',      // datetime of last email/call either direction
    'Next Step',         // free text, e.g. "Call Tue"
    'Notes',
    'Source List',       // which import this came from
    'Added At',
    'Added By',
  ],
  'Homes': [
    'ID',
    'House Number',
    'Street',
    'City',
    'State',
    'ZIP',
    'Neighborhood',
    'Year Built',
    'Market Value',
    'Owner Name',
    'Mailing Address',
    'Mailing City',
    'Mailing State',
    'Mailing ZIP',
    'Roof Age Review',   // '' | original | replaced | unsure  (reviewer checks past aerials BEFORE mailing)
    'Roof Age Reviewed At',
    'Roof Age Reviewed By',
    'Roof Check Result', // outcome of an actual roof check, copied back from the job manager
    'Stage',             // Target | Mailed | Knocked | Talked | Roof check booked (derived; cached)
    'Postcard Version',
    'Phone',             // only if the owner gives it
    'Phone Given By Owner', // Yes when Phone was volunteered at the door
    'Do Not Contact',    // Yes | ''  (a "no" at the door is permanent)
    'Notes',
    'Added At',
  ],
  'Emails': [
    'ID',
    'Partner ID',
    'Version',
    'Step',              // first | followup
    'Scheduled For',     // date it entered a batch
    'Sent At',
    'Gmail Thread ID',
    'Gmail Message ID',
    'Status',            // queued | sent | replied | bounced | cancelled
    'Subject',
    'Sent By',
  ],
  'Events': [
    'ID',
    'Partner ID',
    'Home ID',
    'Email ID',
    'Kind',              // reply | bounce | opt-out | call | postcard | knock | note
    'Outcome',           // knock: no_answer | not_interested | talked | booked | posted_skipped ; call: free text
    'At',
    'Snippet',           // reply snippet or note
    'By',
    'Needs Review',      // Yes when an automation guessed (opt-out wording, address detected)
    'Gmail Message ID',  // reply/bounce: the Gmail message this event came from (dedupe key)
  ],
  'Referrals': [
    'ID',
    'Date',
    'Direction',         // in (partner sent us a lead) | out (we sent the partner a lead)
    'Partner ID',
    'Customer Or Address',
    'Home ID',
    'Request Type',      // listing_report | roof_check | ''
    'Listing Value',     // calls go highest value first
    'Roof Age Years',    // focus on roofs over 12 years
    'Due At',
    'Report Recipient',
    'Owner Contact',
    'Outcome',
    'Job Value',
    'Thanked',           // Yes | ''
    // --- job-manager hand-off: our key + theirs + the four status updates ---
    'Job Manager ID',
    'Report Sent At',
    'Report Link',
    'Estimate Started At',
    'Signed Or Lost',
    'Contract Amount',
    'Paid At',
    'Paid Amount',
    'Notes',
  ],
  'Versions': [
    'Letter',            // A | B | C | E  (postcards: P1, P2, …)
    'Channel',           // email | postcard
    'Partner Type',      // realtor | inspector | insurance | property_manager | homeowner
    'Angle',             // short label: speed, insurance, proof, pay-at-closing
    'Subject',
    'Body',
    'Follow Up Body',
    'QR Code URL',       // postcards only: which roof-check page URL this version carries
    'Locked',            // Yes once sending has started
    'Updated At',
  ],
  'Settings': [
    'Name',
    'Value',
  ],
  'Users': [
    'Email',
    'Name',
    'Role',              // owner | sales | viewonly
    'Active',            // Yes | No
    'Added At',
    'Added By',
  ],
  // Pinned comments (developer tool): one row per comment. The first comment
  // of a thread has Thread ID = its own ID and carries the anchor + Status;
  // replies repeat the Thread ID and leave the anchor blank.
  'Comments': [
    'ID',
    'Thread ID',
    'Status',            // Open | Resolved (root row only)
    'Page',              // today | partners | partner | …
    'Side',              // partners | homes
    'Record ID',         // partner/home id when pinned on a record page
    'Selector',          // CSS path to the element
    'Quote',             // the element's text at the time
    'Label',             // card heading
    'Text',
    'Author',
    'Author Name',
    'To',
    'Created At',
    'Resolved At',
    'Resolved By',
    'Screenshot Drive ID',
    'Screenshot URL',
  ],
};

// ===== Developer tools =====
// Who sees the 💬 Comment pins. Owner only for now (as in SFM); add 'sales' to open it to Tanner.
const COMMENT_ROLES = ['owner'];
const COMMENT_SHOTS_FOLDER = 'ArmorTex Comment Screenshots';   // Drive: My Drive/<folder>/<year>/comment-C-12.png
const COMMENT_SHOT_MAX = 8 * 1024 * 1024;
// The /dev URL of this web app (Apps Script editor → Deploy → Test deployments).
// The "Links: /dev" switch needs it; blank falls back to the dev_url setting,
// then to rewriting /exec → /dev (which serves the pinned version, not HEAD).
const APP_DEV_URL_DEFAULT = '';

// ===== Enums =====
const PARTNER_TYPES = ['realtor', 'inspector', 'insurance', 'property_manager'];
const PARTNER_STAGES = ['Prospect', 'Contacted', 'Replied', 'Partner'];
const HOME_STAGES = ['Target', 'Mailed', 'Knocked', 'Talked', 'Roof check booked'];
const RESPONSES = ['', 'Replied', 'Sent an address', 'Not interested', 'Bounced', 'Opted out'];
const EMAIL_VERSIONS = ['A', 'B', 'C', 'E'];
const EMAIL_STATUSES = ['queued', 'sent', 'replied', 'bounced', 'cancelled'];
const EVENT_KINDS = ['reply', 'bounce', 'opt-out', 'call', 'postcard', 'knock', 'note'];
const KNOCK_OUTCOMES = ['no_answer', 'not_interested', 'talked', 'booked', 'posted_skipped'];

// ===== Settings keys + defaults (seeded by setup(), edited on Settings page) =====
const SETTING = {
  DAILY_CAP:        'daily_cap',
  SENDING_DAYS:     'sending_days',       // e.g. "Tue,Wed,Thu"
  SENDING_HOUR:     'sending_hour',       // Central time, 24h
  PAUSE_SENDING:    'pause_sending',      // Yes | No
  FOLLOW_UP_DAYS:   'follow_up_days',     // business days after first email
  KNOCK_DELAY_DAYS: 'knock_delay_days',   // days after a mailing before the knock list opens
  SENDER_NAME:      'sender_name',        // display name on outgoing email
  SENDER_SIGNATURE: 'sender_signature',
  BUSINESS_ADDRESS: 'business_address',   // required in every email footer
  OPT_OUT_LINE:     'opt_out_line',       // required in every email footer
  JOB_MANAGER_HOOK: 'job_manager_webhook',// Zapier catch hook URL (Roofr) — blank = manual hand-off
  PRINTER_FORMAT:   'printer_format',     // mailing-file column order, comma separated
  CALL_SCRIPT_URL:  'call_script_url',    // Tanner's written call script (Doc link)
  DO_NOT_CONTACT:   'do_not_contact',     // extra emails never to contact, one per line
  DEV_URL:          'dev_url',            // optional: the /dev URL of this web app (owner tool)
};

const SETTING_DEFAULTS = {
  daily_cap:            '50',
  sending_days:         'Tue,Wed,Thu',
  sending_hour:         '9',
  pause_sending:        'No',
  follow_up_days:       '4',
  knock_delay_days:     '5',
  sender_name:          'Brian Kanzaki',
  sender_signature:     'Brian Kanzaki\nArmorTex Roofs',
  business_address:     '',
  opt_out_line:         "Reply 'no thanks' and I won't email again.",
  job_manager_webhook:  '',
  printer_format:       'Owner Name,Mailing Address,Mailing City,Mailing State,Mailing ZIP',
  call_script_url:      '',
  do_not_contact:       '',
  dev_url:              '',
};

const ROOF_AGE_REVIEWS = ['', 'original', 'replaced', 'unsure'];

// ===== Roles and pages =====
const ROLES = [
  { key: 'owner',    label: 'Owner' },
  { key: 'sales',    label: 'Sales' },
  { key: 'viewonly', label: 'View only' },
];

const PAGE_CATALOG = [
  { key: 'today',    label: 'Today' },
  { key: 'partners', label: 'Partners' },
  { key: 'homes',    label: 'Homes' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'settings', label: 'Settings' },
];

const DEFAULT_ROLE_ACCESS = {
  owner:    ['today', 'partners', 'homes', 'campaign', 'settings'],
  sales:    ['today', 'partners', 'homes', 'campaign'],
  viewonly: ['today', 'partners', 'homes', 'campaign'],
};

const WRITE_ROLES = ['owner', 'sales'];   // who may change data
const ADMIN_ROLES = ['owner'];            // who may import lists, edit settings, manage users

// ===== Seed versions (unlocked placeholders; Brian writes the real copy) =====
const SEED_VERSIONS = [
  { Letter: 'A', Channel: 'email', 'Partner Type': 'realtor', Angle: 'speed' },
  { Letter: 'B', Channel: 'email', 'Partner Type': 'realtor', Angle: 'insurance' },
  { Letter: 'C', Channel: 'email', 'Partner Type': 'realtor', Angle: 'proof' },
  { Letter: 'E', Channel: 'email', 'Partner Type': 'realtor', Angle: 'pay-at-closing' },
];
