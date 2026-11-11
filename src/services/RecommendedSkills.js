// Curated names shared by profile recommendations and future TOR extraction.
// Keep different capabilities separate; this is not a synonym/substring matcher.
const RECOMMENDED_SKILL_GROUPS = [
  { category: 'Software Development & Maintenance', skills: [
    'Software Development', 'Software Maintenance', 'Web Development', 'Mobile Application Development',
    'API Development', 'Systems Integration', 'Software Testing', 'Technical Support',
  ] },
  { category: 'Networking & Systems', skills: [
    'Network Administration', 'Network Maintenance', 'Network Monitoring', 'Network Security',
    'Firewall Administration', 'Server Administration', 'Server Maintenance', 'System Monitoring',
    'Linux', 'Windows',
  ] },
  { category: 'Databases & Recovery', skills: [
    'Database Administration', 'Database Maintenance', 'Database Backup', 'Database Recovery',
    'Database Backup and Recovery', 'Data Migration', 'Disaster Recovery',
    'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Microsoft SQL Server', 'Oracle Database',
  ] },
  { category: 'Cloud & DevOps', skills: [
    'Cloud Administration', 'Cloud Infrastructure', 'Virtualization', 'CI/CD',
    'Docker', 'Kubernetes', 'Git', 'AWS', 'Azure', 'Google Cloud',
  ] },
  { category: 'Cybersecurity', skills: [
    'Cybersecurity', 'Vulnerability Assessment', 'Penetration Testing',
    'Security Monitoring', 'Incident Response', 'Identity and Access Management',
  ] },
  { category: 'Programming & Frameworks', skills: [
    'Python', 'C', 'C++', 'C#', 'Assembly', 'Java', 'JavaScript', 'TypeScript',
    'Go', 'Rust', 'PHP', 'Ruby', 'Kotlin', 'Swift', 'Dart', 'R', 'MATLAB',
    'Bash', 'PowerShell', 'React', 'Node.js',
  ] },
];

const key = name => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

function recommendedSkillGroups(vocabulary) {
  const existing = new Map(vocabulary.map(skill => [key(skill.name), skill.name]));
  return RECOMMENDED_SKILL_GROUPS.map(group => ({
    category: group.category,
    skills: group.skills.map(name => existing.get(key(name)) || name),
  }));
}

function extractionVocabulary(vocabulary) {
  // Put the prepared tags first; retain every existing specialist tag as guidance.
  return [...new Set([
    ...recommendedSkillGroups(vocabulary).flatMap(group => group.skills),
    ...vocabulary.map(skill => skill.name),
  ])];
}

async function seedRecommendedSkills(resolve) {
  for (const group of RECOMMENDED_SKILL_GROUPS) {
    for (const name of group.skills) await resolve(name);
  }
}

module.exports = { RECOMMENDED_SKILL_GROUPS, recommendedSkillGroups, extractionVocabulary, seedRecommendedSkills };
