import React from 'react';
import { Controller } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Generic react-hook-form field wrapper: label + control + live French error.
 * Pass a render-prop child receiving { field, fieldState }.
 */
export function FormField({ control, name, label, className, hint, children }) {
  return (
    <div className={className}>
      <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) => (
          <>
            {children({ field, fieldState })}
            {fieldState.error && <p className="text-xs text-destructive mt-1">{fieldState.error.message}</p>}
            {!fieldState.error && hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
          </>
        )}
      />
    </div>
  );
}

const errBorder = (fieldState) => (fieldState?.error ? 'border-destructive focus-visible:ring-destructive' : '');

export function FormText({ control, name, label, placeholder, className, disabled }) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {({ field, fieldState }) => (
        <Input {...field} value={field.value ?? ''} placeholder={placeholder} disabled={disabled}
          className={errBorder(fieldState)} />
      )}
    </FormField>
  );
}

export function FormNumber({ control, name, label, placeholder, className, step = 0.01, disabled }) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {({ field, fieldState }) => (
        <Input type="number" step={step} disabled={disabled}
          value={field.value ?? ''}
          onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder={placeholder}
          className={cn('number-fr', errBorder(fieldState))} />
      )}
    </FormField>
  );
}

export function FormDate({ control, name, label, className, disabled }) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {({ field, fieldState }) => (
        <Input type="date" disabled={disabled} value={field.value ?? ''} onChange={e => field.onChange(e.target.value)}
          className={errBorder(fieldState)} />
      )}
    </FormField>
  );
}

export function FormTextarea({ control, name, label, rows = 3, placeholder, className }) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {({ field, fieldState }) => (
        <Textarea {...field} value={field.value ?? ''} rows={rows} placeholder={placeholder} className={errBorder(fieldState)} />
      )}
    </FormField>
  );
}

export function FormSelect({ control, name, label, options, placeholder = 'Sélectionner', className, disabled }) {
  return (
    <FormField control={control} name={name} label={label} className={className}>
      {({ field, fieldState }) => (
        <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={disabled}>
          <SelectTrigger className={errBorder(fieldState)}><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            {options.map(o => {
              const value = typeof o === 'string' ? o : o.value;
              const lbl = typeof o === 'string' ? o : o.label;
              return <SelectItem key={value} value={value}>{lbl}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      )}
    </FormField>
  );
}