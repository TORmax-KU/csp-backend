pm.test('Recommendations are available without authentication', () => {
  pm.response.to.have.status(200);
});
const groups = pm.response.json();
pm.test('Recommendations cover six categories with common operational skills', () => {
  pm.expect(groups).to.have.lengthOf(6);
  const names = groups.flatMap(group => group.skills).map(name => name.toLowerCase());
  for (const name of ['python', 'software maintenance', 'network maintenance', 'database backup and recovery']) {
    pm.expect(names).to.include(name);
  }
  pm.expect(new Set(names).size).to.equal(names.length);
});
pm.test('Different database and networking capabilities remain separate', () => {
  const names = groups.flatMap(group => group.skills).map(name => name.toLowerCase());
  for (const name of ['database backup', 'database recovery', 'network maintenance', 'network security']) {
    pm.expect(names).to.include(name);
  }
});
