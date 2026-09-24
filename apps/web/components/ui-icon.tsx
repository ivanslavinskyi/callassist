// Existing Heroicons 2.2.0 Outline paths (MIT: public/brand/heroicons-LICENSE),
// with matching 24px outline icons for the registration and landing controls.
const icons = {
  "sun": <><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" /></>,
  "moon": <><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></>,
  "bars-3": <><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></>,
  "x-mark": <><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></>,
  "eye": <><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75 9.75 6.75 9.75 6.75-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-slash": <><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.58 5.36A11.9 11.9 0 0 1 12 5.25c4.6 0 8.39 2.7 9.75 6.75a11.18 11.18 0 0 1-3.13 4.63M6.07 6.07A11.3 11.3 0 0 0 2.25 12c1.36 4.05 5.15 6.75 9.75 6.75 1.2 0 2.35-.18 3.42-.52" /><path strokeLinecap="round" strokeLinejoin="round" d="M9.88 9.88a3 3 0 0 0 4.24 4.24" /></>,
  "arrow-up": <><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7 7-7 7 7" /></>
};
export function UiIcon({name, className = ""}: {name: keyof typeof icons; className?: string}) {
  return <svg className={`ui-icon ${className}`} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">{icons[name]}</svg>;
}
