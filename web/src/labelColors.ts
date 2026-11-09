/** the one palette for labels (issue, project, initiative), wherever a label is created: Settings,
 *  the create modal, a label menu. Before, each place had its own list, so the same name got a
 *  different colour depending on where it was made. */
export const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];

/** the colour a new label gets when nobody picked one: the next in the palette after the existing labels */
export const nextLabelColor = (existing: number) => LABEL_COLORS[existing % LABEL_COLORS.length];
