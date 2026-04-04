const withOpacity = (variable) => ({ opacityValue }) => {
  if (opacityValue === undefined) {
    return `rgb(var(${variable}) / 1)`;
  }

  return `rgb(var(${variable}) / ${opacityValue})`;
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: withOpacity('--color-primary-rgb'),
        'primary-hover': withOpacity('--color-primary-hover-rgb'),
        'primary-active': withOpacity('--color-primary-active-rgb'),
        'primary-light': withOpacity('--color-primary-light-rgb'),
        accent: withOpacity('--color-accent-rgb'),
        success: withOpacity('--color-success-rgb'),
        warning: withOpacity('--color-warning-rgb'),
        error: withOpacity('--color-error-rgb'),
        background: withOpacity('--color-background-rgb'),
        surface: withOpacity('--color-surface-rgb'),
        'text-primary': withOpacity('--color-text-primary-rgb'),
        'text-secondary': withOpacity('--color-text-secondary-rgb'),
        border: withOpacity('--color-border-rgb'),
        'accent-soft': withOpacity('--color-accent-soft-rgb'),
        'success-soft': withOpacity('--color-success-soft-rgb'),
        'warning-soft': withOpacity('--color-warning-soft-rgb'),
        'error-soft': withOpacity('--color-error-soft-rgb'),
      },
      boxShadow: {
        soft: '0 10px 30px rgba(15, 23, 42, 0.06)',
        card: '0 6px 20px rgba(15, 23, 42, 0.05)',
        focus: '0 0 0 4px rgba(79, 110, 247, 0.18)',
      },
    },
  },
  plugins: [],
}

