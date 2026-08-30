import React from 'react';
import LandingHero from './hero/LandingHero';
import BenefitsSection from './sections/BenefitsSection';
import TestimonialsSection from './sections/TestimonialsSection';
import FaqSection from './sections/FaqSection';
import FinalCta from './sections/FinalCta';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <LandingHero />
      <BenefitsSection />
      <TestimonialsSection />
      <FaqSection />
      <FinalCta />
    </div>
  );
}