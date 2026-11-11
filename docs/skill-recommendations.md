# Shared technical skill recommendations

`GET /api/skills/recommendations` is public and read-only. It returns an array of
`{ category: string, skills: string[] }` groups. Failures return HTTP 500 with a
`message`. Edit Profile displays these groups, supports retry on fetch failure,
and keeps custom input and the existing 30-skill limit.

`src/services/RecommendedSkills.js` owns the curated English names. Server startup
adds missing catalog entries using the same resolver as profile saves. Existing
entries and IDs are reused; projects and user selections are not migrated.
Saving a profile retains the existing user-scoped matching recalculation.

Future TOR analysis receives the prepared tags first, followed by all existing
specialist tags. Prompt `tor-pdf-v5-shared-skills` asks Vertex to copy an existing
name when meaning and scope agree, and to create a reusable English name only
when no existing tag fits. Every required skill still needs document evidence.
Backup, recovery, maintenance and security are distinct competencies. No fuzzy
substring matching or automatic merging changes existing match percentages.

This instruction guides model naming; it does not guarantee semantic equivalence.
Completed analyses retain their stored requirements and prompt version.

Verification: `node --test test/RecommendedSkills.test.js test/TorAnalysis.test.js
test/MatchingEngine.test.js test/UserAccess.test.js`; the existing Vertex HTTP
simulation also checks vocabulary transport, shared ID reuse, evidenced new tag
creation and 429 handling in an isolated local MongoDB database.
