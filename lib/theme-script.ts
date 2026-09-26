export const THEME_STORAGE_KEY = 'mgm-theme'

/**
 * Runs in <head> before paint: applies the saved choice, or the OS setting, as
 * html[data-theme] so there is no flash of the wrong theme.
 */
export const themeScript = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=c==='dark'||(c!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}})()`
