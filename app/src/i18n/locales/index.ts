import type { StringKey } from './en';
import hi from './hi';
import bn from './bn';
import te from './te';
import mr from './mr';
import ta from './ta';
import ur from './ur';
import gu from './gu';
import kn from './kn';
import ml from './ml';
import or from './or';
import pa from './pa';
import asm from './as';

export type Translation = Partial<Record<StringKey, string>>;

/** Every language except English (the fallback in translate()). Native-speaker review welcome. */
export const TRANSLATIONS: Record<string, Translation> = { hi, bn, te, mr, ta, ur, gu, kn, ml, or, pa, as: asm };
