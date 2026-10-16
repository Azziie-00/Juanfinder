export const coursesMatch = (groupCourse?: string, adviserCourse?: string) => {
  const group = groupCourse?.trim().toLowerCase();
  const adviser = adviserCourse?.trim().toLowerCase();
  return Boolean(group && group !== 'unspecified' && adviser && adviser !== 'unspecified' && group === adviser);
};
