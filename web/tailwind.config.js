/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e5ff",
          500: "#3b6ef5",
          600: "#2b56d4",
          700: "#2244ab",
          900: "#16265c",
        },
      },
    },
  },
  plugins: [],
};
