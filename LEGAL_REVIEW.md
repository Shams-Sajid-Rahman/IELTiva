# Legal Review Pack

For a qualified lawyer reviewing IELTiva before launch. It describes what the software does and lists the questions to answer.

**This is not legal advice, and IELTiva doesn't claim to comply with any law.** It was prepared by a software engineer's AI assistant from the code and public secondary sources. Everything about the law below needs confirming.

## What IELTiva is

An AI-assisted IELTS preparation service, independent of the IELTS partners. It launches first in Bangladesh, and may later serve other countries. It sells prepaid packages. No account, policy or payment is live yet.

## Personal data held

| Data | Purpose | Kept for | Goes to |
|---|---|---|---|
| Name, email, password hash, optional photo, country, timezone | Account | Until deletion | Email provider (Resend) |
| Target band, exam date, goals | Personal planning | Until deletion | Nobody |
| Answers, scores, practice activity | Results and analytics | Until deletion | Nobody |
| Writing | Feedback | Until deletion | **Anthropic (AI)**, after consent |
| Voice recordings | Speaking feedback | 90 days by default, and students can delete sooner | **Microsoft Azure (speech)**, after consent, plus Cloudflare R2 for storage |
| Transcripts and pronunciation measures | Speaking feedback | Until deletion | **Anthropic** receives the transcript |
| Tutor conversations | Tutoring | Until deletion | **Anthropic**, with obvious emails and numbers removed first |
| Purchases and transactions | Payments and accounting | Kept after deletion with identity removed | The chosen gateway |
| IP address and browser | Security | Sessions until expiry, audit log IPs 365 days | Nobody |
| Calibration samples | Checking AI accuracy | While used | De-identified, with separate consent |

Card numbers and CVV are never received or stored.

## What students can do

- Give or withdraw consent separately for AI processing, speech processing and calibration use. Consent is recorded with its wording version.
- Withdrawing speech consent deletes their recordings.
- Delete a recording at any time.
- Download a copy of their data as a file.
- Delete their account, with a 14-day period to cancel.

## What's kept after account deletion

Payment records stay with the name and email removed, and audit entries stay with their personal fields cleared. AI cost records stay without the user link. De-identified calibration samples stay. Anything already sent to AI or speech providers is outside IELTiva's control, as are any backups you set up.

## Questions for the lawyer

### Bangladesh

Public sources disagree about which instrument is in force, so **please start here.** The Personal Data Protection Ordinance 2025 was reported as gazetted in November 2025. One source says a Personal Data Protection Act 2026 replaced it in April 2026, while another paper from that time refers to an amending ordinance.

1. Which law applies now, from what date, and do any parts take effect later?
2. **Data location:** reports say some classes of data ("confidential" or "restricted") must be stored in Bangladesh, and that transfers abroad need equivalent protection. IELTiva sends student work to providers abroad, and R2 isn't located in Bangladesh by design. Which class does this data fall under? Does this design work as it stands? **This could require architecture changes, so it should be answered first.**
3. Is separate consent needed for transfers abroad, and is the current wording enough?
4. Are voice recordings or pronunciation measures sensitive data, or biometric data?
5. Is registration, a data protection officer, a local representative or breach notification required?
6. Which rules from Bangladesh Bank or tax and VAT law affect online sales, foreign currency pricing, invoices and how long financial records must be kept?
7. Do the Cyber Safety rules or consumer protection law add duties, such as for refunds?

### Other markets

Please confirm which apply before selling there. These are starting points only: EU and UK GDPR, India's Digital Personal Data Protection Act 2023, and the rules of other planned countries.

### Everywhere

1. **Minors:** IELTS candidates can be under 18. There's no age check today. Is a minimum age or parental consent needed?
2. **Automated assessment:** AI feedback shapes study decisions. Do rules on automated decisions or AI transparency apply?
3. **Processor agreements** with Anthropic, Microsoft, Cloudflare, Resend and payment gateways: what's needed, and how long do they retain data?
4. **Retention periods:** are these right: 90 days for recordings, 365 for audit IPs, 7 for exports, 14 for the deletion window, and indefinite for practice data until deletion?
5. **Can financial records be kept after deletion?** For how long, and what must the privacy notice say?
6. **Calibration:** is the de-identification enough, and is the consent basis sound?
7. **Instructor data:** markers and instructors are also individuals with rights.

### Commercial and intellectual property

1. **IELTS name:** IELTS is a registered trademark. Is the way the name is used acceptable, including the wording that IELTiva is independent?
2. **Content:** all exam content must be original or licensed. Please advise on what evidence to keep.
3. **Band claims:** is the wording around estimated bands and "not an official result" enough?
4. **Refund policy:** the 7-day window is a placeholder. What must the policy say, and what do consumer rules require?
5. **Prepaid credits:** can credits expire? What must be disclosed? Could this count as stored value?
6. **Live gateway contracts:** check their terms on what's sold and on refunds.

## Documents still needed

None of these exist as reviewed legal text: Privacy Notice, Terms of Service, Refund Policy, Cookie Notice, and AI and Recording Consent wording. The consent wording in the app was written by the developer, and the registration page's terms need a final version.

## Sources for the Bangladesh questions

Secondary sources, listed as a starting point:

- [The Daily Star: key takeaways of the 2025 Ordinance](https://www.thedailystar.net/tech-startup/news/bangladeshs-personal-data-protection-ordinance-2025-key-takeaways-4015401)
- [Mahbub & Company: highlights for businesses](https://mahbub-law.com/key-highlights-of-the-personal-data-protection-ordinance-2025-for-businesses)
- [CCIA: views on the Ordinance (April 2026)](https://ccianet.org/wp-content/uploads/2026/04/CCIA-Views-on-Bangladeshs-Personal-Data-Protection-Ordinance.pdf)
- [ConsentStack: reference to an Act of 2026](https://www.consentstack.io/regulations/bd-pdpo)

The official text should be checked at [bdlaws.minlaw.gov.bd](http://bdlaws.minlaw.gov.bd).
