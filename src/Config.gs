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
const APP_VERSION    = '0.11.2';
const APP_BUILD_DATE = '2026-11-23';

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
  CAMPAIGNS: 'Campaigns',
  LISTS:     'Lists',
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
  'Campaigns': 'CP',
  'Lists':     'L',
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
    // --- type profiles (sparse; which ones apply is in PARTNER_TYPE_PROFILES) ---
    'Areas Served',
    'Listings Per Year',     // realtor
    'Avg Listing Value',     // realtor
    'Inspections Per Month', // inspector
    'Refers Roofers',        // inspector: Yes | No | Sometimes
    'Carriers',              // insurance
    'Handles Claims',        // insurance: Yes | No
    'Doors Managed',         // property manager
    'Property Types',        // property manager
    'Decision Maker',        // property manager: Yes | No
    'Partner Since',         // set the first time Stage becomes Partner (established relationship)
    'Rep',                   // staff email who owns this relationship (blank = unassigned)
    'Skip Email Test',       // Yes = never gets a version or a batch slot (e.g. already emailed by hand)
    'Call Queue',            // Yes = on the call list until a call is logged after Last Contact
    'Quo Contact ID',        // the contact Quo holds for this person (pushed from here; the app is the source of truth)
    'Campaign ID',           // the email campaign this person was dealt into (one at a time)
    'Lists',                 // curated lists this person is on: list IDs, comma-separated (L-1,L-4)
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
    'Campaign ID',       // appended 2026-11-23
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
    'Needs Review',      // Yes when an automation guessed (opt-out wording, address detected, unknown caller)
    'Gmail Message ID',  // reply/bounce: the Gmail message this event came from (dedupe key)
    // Calls and texts that come in from the phone system (Quo). Appended 2026-11-22.
    'Direction',         // in | out
    'Duration',          // seconds (calls)
    'Phone',             // the other party's number, digits only
    'Recording URL',     // call recording or voicemail audio
    'Transcript',        // call transcript or voicemail transcript (text)
    'Source',            // quo | app | trigger
    'Source ID',         // Quo call / message id (dedupe + later updates)
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
  'Lists': [
    'ID',                // L-1
    'Name',
    'Notes',
    'Created At',
    'Created By',
  ],
  'Campaigns': [
    'ID',                // CP-1
    'Name',
    'Status',            // draft | running | paused | done
    'Partner Type',      // realtor | inspector | insurance | property_manager
    'Lists',             // audience: list IDs (L-3) and/or import-file names, comma-separated; blank = everyone of the type
    'Stages',            // Prospect,Contacted,Replied; blank = every pipeline stage (never Partner)
    'Versions',          // letters in play, e.g. A,B,C
    'Start Date',
    'Sending Days',      // blank = Settings
    'Daily Cap',         // blank = Settings
    'Follow Up Days',    // blank = Settings
    'Created At',
    'Created By',
    'Notes',
    'Call After Days',   // the call plan: business days after the first email with no reply → Today's call list (blank = no call step); appended 2026-11-23
    'Tags',              // free words, comma-separated, lowercase: the library's filing system (appended 2026-11-23)
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
    'Campaign ID',       // which campaign this wording belongs to (appended 2026-11-23)
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
const RESPONSES = ['', 'Replied', 'Sent an address', 'Referred a job', 'Sent a claim', 'Sent a property', 'Not interested', 'Bounced', 'Opted out'];
const COLD_RESPONSES = ['Not interested', 'Bounced', 'Opted out'];   // a reply that closes the door: back to cold
const WIN_RESPONSES = ['Sent an address', 'Referred a job', 'Sent a claim', 'Sent a property'];

// "Sent", "sent 11/3", "Bilingual | sent" in an imported Notes column = already emailed by hand.
const HAND_SENT_RE = /\bsent\b(?:\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?/i;

// Days since the last contact before an established partner shows as "gone cold".
const PARTNER_TOUCH_DAYS = 30;

// ===== Partner type profiles =====
// One entry per partner type: what we call them, the company label, the extra
// facts Tanner wants before a call (Partners columns), what counts as a win
// (a Response value), and which email versions they get. The list tab and the
// record page read this; a new type is a new entry, not a new screen.
const PARTNER_TYPE_PROFILES = {
  realtor: {
    label: 'Realtor', plural: 'Realtors', companyLabel: 'Brokerage',
    fields: [
      { key: 'Listings Per Year', type: 'number', hint: 'how many listings they carry a year' },
      { key: 'Avg Listing Value', type: 'money', hint: 'typical listing price' },
      { key: 'Areas Served', type: 'text', hint: 'Longview, White Oak…' },
    ],
    win: 'Sent an address', winVerb: 'sent an address for a listing report', winNoun: 'addresses',
    pitch: 'Free photo roof report on any listing within 48 hours.',
    versions: ['A', 'B', 'C', 'E'],
  },
  inspector: {
    label: 'Home inspector', plural: 'Home inspectors', companyLabel: 'Inspection company',
    fields: [
      { key: 'Inspections Per Month', type: 'number', hint: 'volume' },
      { key: 'Refers Roofers', type: 'choice', options: ['', 'Yes', 'Sometimes', 'No'], hint: 'do they already hand out a roofer' },
      { key: 'Areas Served', type: 'text' },
    ],
    win: 'Referred a job', winVerb: 'referred a homeowner from an inspection', winNoun: 'referrals',
    pitch: 'When the inspection flags the roof, we do the detailed report and the repair; they keep the credit.',
    versions: [],
  },
  insurance: {
    label: 'Insurance agent', plural: 'Insurance agents', companyLabel: 'Agency',
    fields: [
      { key: 'Carriers', type: 'text', hint: 'State Farm, Allstate…' },
      { key: 'Handles Claims', type: 'choice', options: ['', 'Yes', 'No'], hint: 'do claims come through this office' },
      { key: 'Areas Served', type: 'text' },
    ],
    win: 'Sent a claim', winVerb: 'sent a claim referral', winNoun: 'claims',
    pitch: 'Roof condition reports that keep their insureds insurable; deductible always billed in full.',
    versions: [],
  },
  property_manager: {
    label: 'Property manager', plural: 'Property managers', companyLabel: 'Company',
    fields: [
      { key: 'Doors Managed', type: 'number', hint: 'units / houses under management' },
      { key: 'Property Types', type: 'text', hint: 'single family, duplex, small multi…' },
      { key: 'Decision Maker', type: 'choice', options: ['', 'Yes', 'No'], hint: 'can they pick the roofer' },
    ],
    win: 'Sent a property', winVerb: 'sent a property for a roof check', winNoun: 'properties',
    pitch: 'One call for every roof in the portfolio: report, repair, replacement, yearly check.',
    versions: [],
  },
};
const EMAIL_VERSIONS = ['A', 'B', 'C', 'E'];
const CAMPAIGN_STATUSES = ['draft', 'running', 'paused', 'done'];
const DEFAULT_CALL_AFTER_DAYS = 7;   // a new campaign's call plan: call anyone who hasn't replied 7 business days after the first email
const DEFAULT_CAMPAIGN = { Name: 'Realtor email test', 'Partner Type': 'realtor', Versions: 'A', Status: 'running' };   // seeded once; the one campaign the app ran before campaigns existed
const EMAIL_STATUSES = ['queued', 'sent', 'replied', 'bounced', 'cancelled'];
const EVENT_KINDS = ['reply', 'bounce', 'opt-out', 'call', 'text', 'voicemail', 'postcard', 'knock', 'note'];
const CALL_OUTCOMES = ['talked', 'voicemail', 'no_answer', 'missed'];   // Quo maps to these; a person may type anything
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
  // Quo (the phone system). The API key itself lives in Script Properties, never in the Sheet.
  QUO_NUMBERS:      'quo_numbers',        // JSON: Quo numbers in the workspace [{id, number, name, users:[email]}]
  QUO_USERS:        'quo_users',          // JSON: Quo user id → email
  QUO_WATCH:        'quo_watch',          // JSON: Quo number ids we log calls/texts for
  QUO_HOOK_URL:     'quo_hook_url',       // this web app's /exec URL, pasted by the owner
  QUO_WEBHOOK_ID:   'quo_webhook_id',     // the webhook Quo gave us
  QUO_WEBHOOK_URL:  'quo_webhook_url',    // what Quo posts to (hook URL + src + token)
  QUO_CALL_LINKS:   'quo_call_links',     // Yes = Call/Text buttons open the Quo app (openphone://) instead of the phone's dialer
  // Sample roof report (warm tier): the stock PDF sent from the record with one press
  SAMPLE_REPORT_FILE:    'sample_report_file',     // Drive link or file id of the PDF
  SAMPLE_REPORT_SUBJECT: 'sample_report_subject',
  SAMPLE_REPORT_BODY:    'sample_report_body',     // {{first}} {{name}} {{company}} {{rep}} {{address}}
};

// ===== Quo (phone system) =====
const QUO_API = 'https://api.quo.com';
const QUO_API_VERSION = '2026-03-30';                      // webhooks are versioned by date; v1 endpoints are not
const QUO_HOOK_EVENTS = ['call.completed', 'call.recording.completed', 'call.transcript.completed', 'call.summary.completed', 'call.voicemail.completed', 'message.received', 'message.delivered', 'contact.updated'];
const QUO_CONTACT_SOURCE = 'armortex-outreach';           // stamped on every contact we push, so Quo can tell ours apart
const PROP_QUO_API_KEY = 'QUO_API_KEY';
const PROP_QUO_HOOK_TOKEN = 'QUO_HOOK_TOKEN';              // random token in the webhook URL; the only thing a poster must know
const PROP_QUO_WEBHOOK_KEY = 'QUO_WEBHOOK_KEY';            // whsec_… Quo's signing key (kept for a relay; Apps Script can't read headers)
const PROP_QUO_LAST_HOOK = 'QUO_LAST_HOOK';                // JSON: what the last delivery did
const PROP_QUO_LAST_ERROR = 'QUO_LAST_ERROR';

const SETTING_DEFAULTS = {
  daily_cap:            '50',
  sending_days:         'Tue,Wed,Thu',
  sending_hour:         '9',
  pause_sending:        'No',
  follow_up_days:       '4',
  knock_delay_days:     '5',
  sender_name:          'Brian Kanzaki',
  sender_signature:     'Brian Kanzaki\nArmorTex Roofs',
  business_address:     '3310 South Broadway Ave, Ste 225A, Tyler, TX 75701',
  opt_out_line:         "Reply 'no thanks' and I won't email again.",
  job_manager_webhook:  '',
  printer_format:       'Owner Name,Mailing Address,Mailing City,Mailing State,Mailing ZIP',
  call_script_url:      '',
  do_not_contact:       '',
  dev_url:              '',
  sample_report_file:    '',
  sample_report_subject: 'Sample roof report from ArmorTex',
  sample_report_body:    "Hi {{first}},\n\nHere's the sample roof report I mentioned. It's what you'd get on any of your listings within 48 hours of sending me the address, at no cost and with no strings.\n\nIf there's a property you'd like one on, reply with the address and I'll get it going.\n\n{{rep}}\nArmorTex Roofs\n{{address}}",
};

const ROOF_AGE_REVIEWS = ['', 'original', 'replaced', 'unsure'];

// ===== Roles and pages =====
const ROLES = [
  { key: 'owner',    label: 'Owner' },
  { key: 'sales',    label: 'Sales' },
  { key: 'viewonly', label: 'View only' },
];

const PAGE_CATALOG = [
  { key: 'today',     label: 'Today' },
  { key: 'prospects', label: 'Prospects' },   // cold: never answered (Stage Prospect/Contacted, or a no)
  { key: 'marketing', label: 'Marketing' },   // warm: replied, being worked (Stage Replied)
  { key: 'partners',  label: 'Partners' },    // hot: the book (Stage Partner)
  { key: 'lists',     label: 'Lists' },       // curated groups of people, picked by hand or by filter; campaigns point at them
  { key: 'homes',    label: 'Homes' },
  { key: 'campaigns', label: 'Campaigns' },  // the ledger; page=campaign&id=CP-1 is one campaign's record
  { key: 'settings', label: 'Settings' },
];

const DEFAULT_ROLE_ACCESS = {
  owner:    ['today', 'prospects', 'marketing', 'partners', 'lists', 'homes', 'campaigns', 'settings'],
  sales:    ['today', 'prospects', 'marketing', 'partners', 'lists', 'homes', 'campaigns'],
  viewonly: ['today', 'prospects', 'marketing', 'partners', 'lists', 'homes', 'campaigns'],
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
