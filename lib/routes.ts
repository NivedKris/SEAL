export type AppRoute = {
  href: string;
  label: string;
  labelAr: string;
  user: string;
  role: string;
  roleAr: string;
  blurb: string;
};

/** The views people work in. Admin is reached from the gear icon. */
export const APP_ROUTES: AppRoute[] = [
  { href: "/today", label: "Today", labelAr: "اليوم", user: "Noura Al Mansoori", role: "Revenue cycle", roleAr: "دورة الإيرادات", blurb: "The whole hospital's claims today, from the doctor's room to the insurer." },
  { href: "/emr", label: "Patients", labelAr: "المرضى", user: "Clinic desk", role: "All doctors", roleAr: "جميع الأطباء", blurb: "Your clinic list, with SEAL checking every order as you write." },
  { href: "/doctor", label: "Questions", labelAr: "الأسئلة", user: "Doctors", role: "On their phones", roleAr: "على هواتفهم", blurb: "Quick answers the insurer needs, in your own words." },
  { href: "/billing", label: "Claims", labelAr: "المطالبات", user: "Noura Al Mansoori", role: "Billing officer", roleAr: "مسؤولة الفوترة", blurb: "Every claim checked before it goes, with the exact fix." },
  { href: "/clinic", label: "Finance", labelAr: "المالية", user: "Khalid Al Suwaidi", role: "Chief financial officer", roleAr: "المدير المالي", blurb: "Cash at risk, cash recovered and how fast it arrives." },
  { href: "/rules", label: "Rules", labelAr: "القواعد", user: "Rania Fakhoury", role: "Coding specialist", roleAr: "أخصائية الترميز", blurb: "The insurer rules SEAL checks, and new ones it has learned." },
  { href: "/ai-health", label: "Insights", labelAr: "رؤى", user: "Priya Nair", role: "Quality lead", roleAr: "مسؤولة الجودة", blurb: "How well SEAL is doing for the hospital, in plain words." },
];

export const userFor = (pathname: string) => APP_ROUTES.find((r) => pathname === r.href || pathname.startsWith(r.href + "/"));
