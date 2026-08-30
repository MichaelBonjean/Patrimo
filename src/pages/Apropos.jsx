import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, Shield, Heart, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TEAM_PHOTO = 'https://media.base44.com/images/public/69fa157a3c137d8c3bf0b79b/dea1efa38_generated_image.png';
const CONTACT_EMAIL = 'bonjour@patrimo.fr';

export default function Apropos() {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-display font-semibold">À propos de Patrimo</h1>
        <p className="text-sm text-muted-foreground mt-2">Une équipe française, un produit humble, un support humain.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-center">
        <img src={TEAM_PHOTO} alt="L'équipe Patrimo" className="w-44 h-44 rounded-2xl object-cover shadow-md border border-border" />
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold mb-2">Notre mission</h2>
          <p className="text-sm text-foreground/85 leading-relaxed">
            Patrimo est né d'un constat simple : la gestion locative demande trop de tableurs, de courriers
            et d'outils épars. Nous centralisons tout dans un cockpit unique, sobre et respectueux de vos
            données — pour que vous pilotiez votre patrimoine sereinement, sans prise de tête.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <Shield className="w-5 h-5 text-primary mb-2" />
          <h3 className="font-semibold text-sm mb-1">Vos données, vos droits</h3>
          <p className="text-xs text-muted-foreground">Export et suppression RGPD intégrés. Aucune revente, aucun tracker.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <Heart className="w-5 h-5 text-accent mb-2" />
          <h3 className="font-semibold text-sm mb-1">Support humain</h3>
          <p className="text-xs text-muted-foreground">Chaque demande est lue par une personne. Réponse sous 24h ouvrées.</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <Sparkles className="w-5 h-5 text-emerald-600 mb-2" />
          <h3 className="font-semibold text-sm mb-1">Produit en progrès</h3>
          <p className="text-xs text-muted-foreground">Nous itérons chaque semaine sur vos retours. Merci de votre confiance.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
        <Mail className="w-6 h-6 mx-auto text-primary mb-2" />
        <p className="text-sm">Une question ? Écrivez-nous directement :</p>
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-display text-lg font-semibold hover:underline">{CONTACT_EMAIL}</a>
        <p className="text-xs text-muted-foreground mt-2">Réponse sous 24h ouvrées. Pour un sujet urgent, ouvrez le bouton <strong>Support</strong> en bas à droite.</p>
        <div className="flex gap-2 justify-center mt-4">
          <Link to="/aide"><Button variant="outline" size="sm">Centre d'aide</Button></Link>
          <Link to="/statut"><Button variant="outline" size="sm">État des services</Button></Link>
        </div>
      </div>
    </div>
  );
}