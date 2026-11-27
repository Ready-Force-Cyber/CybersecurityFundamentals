import type { CloseCallItem } from "../lib/closecall";

// The Close Call items, with their answers. Server-only, like the question
// bank: the browser gets an item's prompt and unit, and sees the answer only
// after the host reveals the round.
//
// Every answer is either arithmetic (shown in the explanation), a published
// standard default (port numbers, TOTP's 30 seconds), or a widely documented
// date, so it can be checked.

export const CLOSE_CALL_ITEMS: CloseCallItem[] = [
  // ---- Authentication: how many guesses a secret really takes ----------
  {
    id: "cc-pin-4",
    prompt: "How many different 4-digit PINs are possible, from 0000 to 9999?",
    unit: "PINs",
    answer: 10_000,
    explanation:
      "Each of the 4 digits has 10 choices: 10 × 10 × 10 × 10 = 10,000. That's why phones lock you out after a few wrong tries — otherwise someone could simply try them all.",
    concept: "authentication",
  },
  {
    id: "cc-code-6",
    prompt: "How many different 6-digit codes can an authenticator app show?",
    unit: "codes",
    answer: 1_000_000,
    explanation:
      "10 to the power of 6 is 1,000,000. The code also expires within about 30 seconds, so guessing the right one in time is very unlikely.",
    concept: "authentication",
  },
  {
    id: "cc-totp-seconds",
    prompt: "An authenticator app's code usually changes every how many seconds?",
    unit: "seconds",
    answer: 30,
    explanation:
      "Authenticator apps use time-based one-time passwords (TOTP), which change every 30 seconds by default. A stolen code is only useful for a moment.",
    concept: "authentication",
  },
  {
    id: "cc-lock-3",
    prompt: "A suitcase lock has 3 dials, each 0 to 9. How many combinations are there?",
    unit: "combinations",
    answer: 1_000,
    explanation:
      "10 × 10 × 10 = 1,000. Short secrets are quick to try one by one, which is why longer passwords are so much safer.",
    concept: "authentication",
  },
  {
    id: "cc-password-4-lower",
    prompt: "How many different 4-letter passwords can be made from lowercase letters a to z only?",
    unit: "passwords",
    answer: 456_976,
    explanation:
      "26 × 26 × 26 × 26 = 456,976. A computer can try that many in under a second. Every extra character multiplies the total by 26 again.",
    concept: "authentication",
  },
  {
    id: "cc-password-2-mixed",
    prompt:
      "How many 2-character passwords can be made from lowercase letters, uppercase letters and digits (62 symbols in all)?",
    unit: "passwords",
    answer: 3_844,
    explanation: "62 × 62 = 3,844. Mixing character types helps, but adding length helps far more.",
    concept: "authentication",
  },

  // ---- Confidentiality: which doors the traffic uses ------------------
  {
    id: "cc-port-https",
    prompt: "Which port number does HTTPS — the padlock in your browser — use by default?",
    unit: "port",
    answer: 443,
    explanation:
      "HTTPS uses port 443 and encrypts what you send and receive. Plain, unencrypted HTTP uses port 80.",
    concept: "confidentiality",
  },
  {
    id: "cc-port-http",
    prompt: "Which port number does plain, unencrypted HTTP use by default?",
    unit: "port",
    answer: 80,
    explanation:
      "HTTP uses port 80, and anything sent over it can be read along the way. That's why websites moved to HTTPS on port 443.",
    concept: "confidentiality",
  },
  {
    id: "cc-port-ssh",
    prompt: "Which port number does SSH, used to log in securely to remote computers, use by default?",
    unit: "port",
    answer: 22,
    explanation:
      "SSH uses port 22. Attackers constantly scan the internet for open port 22 and try to guess logins, so strong keys and passwords matter.",
    concept: "confidentiality",
  },

  // ---- Availability: attacks that knock things offline ----------------
  {
    id: "cc-port-dns",
    prompt: "Which port number does DNS — the internet's address book — use by default?",
    unit: "port",
    answer: 53,
    explanation:
      "DNS uses port 53. If DNS goes down, people can't reach websites by name, even when the websites themselves are fine.",
    concept: "availability",
  },
  {
    id: "cc-year-wannacry",
    prompt: "In what year did the WannaCry ransomware spread around the world?",
    unit: "year",
    answer: 2017,
    explanation:
      "WannaCry hit in May 2017, locking files on hundreds of thousands of computers, including UK hospital systems. A security update released two months earlier would have stopped it.",
    concept: "availability",
  },
  {
    id: "cc-year-morris",
    prompt: "In what year did the Morris worm, one of the first worms to spread across the internet, appear?",
    unit: "year",
    answer: 1988,
    explanation:
      "The Morris worm spread in November 1988 and slowed thousands of computers to a crawl — an early lesson that availability can be attacked too.",
    concept: "availability",
  },

  // ---- Integrity: knowing data hasn't been changed --------------------
  {
    id: "cc-year-stuxnet",
    prompt: "In what year was the Stuxnet worm, which secretly damaged industrial equipment, discovered?",
    unit: "year",
    answer: 2010,
    explanation:
      "Stuxnet was discovered in 2010. It changed how machines behaved while showing operators normal readings — an attack on integrity.",
    concept: "integrity",
  },
  {
    id: "cc-byte-values",
    prompt: "How many different values can a single byte (8 bits) hold?",
    unit: "values",
    answer: 256,
    explanation: "Each bit is 0 or 1, so 8 bits give 2 to the power of 8 = 256 values, from 0 to 255.",
    concept: "integrity",
  },
  {
    id: "cc-sha256-hex",
    prompt:
      "A SHA-256 hash, used to check a file hasn't been changed, is written as how many hexadecimal characters?",
    unit: "characters",
    answer: 64,
    explanation:
      "SHA-256 produces 256 bits, and each hexadecimal character stands for 4 bits: 256 ÷ 4 = 64. Change a single letter in the file and the whole hash changes.",
    concept: "integrity",
  },

  // ---- The art of defending: knowing your network ---------------------
  {
    id: "cc-port-rdp",
    prompt: "Which port number does Windows Remote Desktop (RDP) use by default?",
    unit: "port",
    answer: 3389,
    explanation:
      "RDP listens on port 3389. Leaving it open to the internet is a common way ransomware gangs break in, so defenders close it or put it behind a VPN.",
    concept: "art_of_defending",
  },
  {
    id: "cc-year-iloveyou",
    prompt: "In what year did the ILOVEYOU email worm spread?",
    unit: "year",
    answer: 2000,
    explanation:
      "ILOVEYOU spread in May 2000 through an email attachment that looked like a love letter — a classic case of tricking people rather than machines.",
    concept: "art_of_defending",
  },
  {
    id: "cc-ipv4-bits",
    prompt: "How many bits long is an IPv4 address, like 192.168.1.1?",
    unit: "bits",
    answer: 32,
    explanation:
      "IPv4 addresses are 32 bits: four numbers from 0 to 255. That allows about 4.3 billion addresses, which the internet has run short of.",
    concept: "art_of_defending",
  },
  {
    id: "cc-ipv6-bits",
    prompt: "How many bits long is an IPv6 address?",
    unit: "bits",
    answer: 128,
    explanation: "IPv6 addresses are 128 bits — enough for an almost unimaginable number of devices.",
    concept: "art_of_defending",
  },
  {
    id: "cc-mac-hex",
    prompt: "How many hexadecimal digits are in a device's MAC address, like 3C:22:FB:9A:10:7E?",
    unit: "digits",
    answer: 12,
    explanation:
      "A MAC address is 48 bits, written as 12 hexadecimal digits in six pairs. Networks use it to identify devices on the local network.",
    concept: "art_of_defending",
  },
  {
    id: "cc-osi-layers",
    prompt: "How many layers are in the OSI networking model?",
    unit: "layers",
    answer: 7,
    explanation:
      "The OSI model has 7 layers, from the physical cables up to the apps you use. Defenders use it to describe where an attack happens.",
    concept: "art_of_defending",
  },
];
