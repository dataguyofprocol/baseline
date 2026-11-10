export const LABEL_COLORS = ['#eb5757', '#f2994a', '#f2c94c', '#4cb782', '#3b82f6', '#5e6ad2', '#a78bfa', '#c770f4', '#8a8f98'];

export const nextLabelColor = (existing: number) => LABEL_COLORS[existing % LABEL_COLORS.length];
