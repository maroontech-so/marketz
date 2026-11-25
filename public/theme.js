(() => {
  try {
    const saved = localStorage.getItem('fincapita-theme');
    if (saved === 'dark' || (!saved && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch {}
  if (typeof tailwind !== 'undefined') {
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
            sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
            mono: ['IBM Plex Mono', 'monospace'],
          },
        },
      },
    };
  }
})();
