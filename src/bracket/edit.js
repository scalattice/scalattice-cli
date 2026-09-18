export function applyEdit(content, oldString, newString, { replaceAll = false } = {}) {
  if (oldString == null || oldString === '') {
    throw new Error('old_string is required');
  }
  if (oldString === newString) {
    throw new Error('old_string and new_string are identical');
  }
  const haystack = String(content);
  const needle = String(oldString);
  const next = String(newString);
  if (replaceAll) {
    if (!haystack.includes(needle)) throw new Error('old_string not found in file');
    return haystack.split(needle).join(next);
  }
  const first = haystack.indexOf(needle);
  if (first < 0) throw new Error('old_string not found in file');
  const second = haystack.indexOf(needle, first + needle.length);
  if (second >= 0) {
    throw new Error(
      'old_string found more than once. Add surrounding context, or set replace_all=true.'
    );
  }
  return haystack.slice(0, first) + next + haystack.slice(first + needle.length);
}
