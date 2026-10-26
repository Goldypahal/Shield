import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import HeimdalLogo from '../components/common/HeimdalLogo';
import AuthService, { authErrorMessage, DemoCodes } from '../services/authService';

type Mode = 'login' | 'register' | 'forgot';
type RegisterStep = 'details' | 'codes' | 'pins';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const PIN_RE = /^\d{4,6}$/;

/**
 * Sign in, create an account (email + phone verified by code, password, SOS PIN and
 * duress PIN), or reset a forgotten password. The session is stored by AuthService;
 * App.tsx moves on when it starts.
 */
export default function AuthScreen() {
  const { colors, typography, isDark, radii } = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<RegisterStep>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+91');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [duressPin, setDuressPin] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  // Must be an explicit choice (no pre-selected answer): consent under India's DPDP Act
  const [policeSharing, setPoliceSharing] = useState<boolean | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep('details');
    setError(null);
    setInfo(null);
    setCodeSent(false);
    setPassword('');
    setPassword2('');
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const showDemo = (codes: DemoCodes) => {
    // Only a development backend returns codes; production sends them by email and SMS
    const parts = [codes.demo_email_code && `email ${codes.demo_email_code}`, codes.demo_phone_code && `SMS ${codes.demo_phone_code}`]
      .filter(Boolean);
    if (parts.length) setInfo(`Development server codes: ${parts.join(', ')}`);
  };

  const normEmail = email.trim().toLowerCase();

  const login = () => {
    if (!EMAIL_RE.test(normEmail) || !password) return setError('Enter your email and password.');
    run(async () => { await AuthService.login(normEmail, password); });
  };

  const sendCodes = () => {
    if (!name.trim()) return setError('Enter your name.');
    if (!EMAIL_RE.test(normEmail)) return setError('Enter a valid email address.');
    if (!PHONE_RE.test(phone.trim())) return setError('Enter your phone with country code, e.g. +919876543210.');
    if (password.length < 10) return setError('Password must be at least 10 characters.');
    if (password !== password2) return setError('Passwords do not match.');
    run(async () => {
      showDemo(await AuthService.registerStart(normEmail, phone.trim()));
      setStep('codes');
    });
  };

  const confirmCodes = () => {
    if (!/^\d{6}$/.test(emailCode) || !/^\d{6}$/.test(phoneCode)) return setError('Enter both 6-digit codes.');
    setError(null);
    setStep('pins');
  };

  const createAccount = () => {
    if (!PIN_RE.test(pin)) return setError('Your SOS PIN must be 4-6 digits.');
    if (pin !== pin2) return setError('The SOS PINs do not match.');
    if (!PIN_RE.test(duressPin)) return setError('Your duress PIN must be 4-6 digits.');
    if (duressPin === pin) return setError('The duress PIN must be different from your SOS PIN.');
    if (policeSharing === null) return setError('Choose whether your SOS alerts should also go to the police.');
    run(async () => {
      try {
        await AuthService.registerComplete({
          name: name.trim(), email: normEmail, phone: phone.trim(), password,
          emailCode, phoneCode, pin, duressPin, policeSharing,
        });
      } catch (e) {
        // Codes are single use: a rejected attempt means asking for new ones
        if (authErrorMessage(e).includes('code')) {
          setStep('codes');
          setEmailCode('');
          setPhoneCode('');
        }
        throw e;
      }
    });
  };

  const sendReset = () => {
    if (!EMAIL_RE.test(normEmail)) return setError('Enter the email you signed up with.');
    run(async () => {
      showDemo(await AuthService.forgotPassword(normEmail));
      setCodeSent(true);
    });
  };

  const resetPassword = () => {
    if (!/^\d{6}$/.test(resetCode)) return setError('Enter the 6-digit code from the email.');
    if (password.length < 10) return setError('Password must be at least 10 characters.');
    if (password !== password2) return setError('Passwords do not match.');
    run(async () => {
      await AuthService.resetPassword(normEmail, resetCode, password);
      switchMode('login');
      setInfo('Password changed. Sign in with your new password.');
    });
  };

  const field = (
    label: string, value: string, onChange: (v: string) => void,
    opts: { secure?: boolean; keyboard?: 'email-address' | 'phone-pad' | 'number-pad'; max?: number; auto?: any; hint?: string } = {}
  ) => (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 4 }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={opts.secure}
        keyboardType={opts.keyboard}
        maxLength={opts.max}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={opts.auto}
        style={[styles.input, typography.bodyMedium, { color: colors.textPrimary, borderColor: colors.border, borderRadius: radii.lg }]}
        accessibilityLabel={label}
      />
      {opts.hint && <Text style={[typography.caption, { color: colors.textMuted, marginTop: 4 }]}>{opts.hint}</Text>}
    </View>
  );

  const primary = (label: string, onPress: () => void) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={[styles.primary, { backgroundColor: colors.brandAccent, borderRadius: radii.pill, opacity: busy ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[typography.button, { color: '#FFFFFF' }]}>{label}</Text>}
    </TouchableOpacity>
  );

  const link = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} style={styles.link} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[typography.bodySmall, { color: colors.brandAccent, fontWeight: '600' }]}>{label}</Text>
    </TouchableOpacity>
  );

  const title =
    mode === 'login' ? 'Sign in' :
    mode === 'forgot' ? 'Reset password' :
    step === 'details' ? 'Create your account' : step === 'codes' ? 'Verify email and phone' : 'Set your SOS PINs';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <HeimdalLogo size={56} />
            <Text style={[typography.h2, { color: colors.textPrimary, marginTop: 10 }]}>SHIELD</Text>
          </View>

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl }]}>
            <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 14 }]}>{title}</Text>

            {mode === 'login' && (
              <>
                {field('Email', email, setEmail, { keyboard: 'email-address', auto: 'email' })}
                {field('Password', password, setPassword, { secure: true, auto: 'current-password' })}
                {primary('Sign in', login)}
                {link('Forgot password?', () => switchMode('forgot'))}
                {link('New to SHIELD? Create an account', () => switchMode('register'))}
              </>
            )}

            {mode === 'register' && step === 'details' && (
              <>
                {field('Full name', name, setName, { auto: 'name' })}
                {field('Email', email, setEmail, { keyboard: 'email-address', auto: 'email' })}
                {field('Mobile number', phone, setPhone, { keyboard: 'phone-pad', auto: 'tel',
                  hint: 'Guardians recognise you by this number. We will text a code.' })}
                {field('Password', password, setPassword, { secure: true, auto: 'new-password', hint: 'At least 10 characters. A short phrase works well.' })}
                {field('Repeat password', password2, setPassword2, { secure: true, auto: 'new-password' })}
                {primary('Send verification codes', sendCodes)}
                {link('Already have an account? Sign in', () => switchMode('login'))}
              </>
            )}

            {mode === 'register' && step === 'codes' && (
              <>
                <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: 12 }]}>
                  We sent a 6-digit code to {normEmail} and another by SMS to {phone.trim()}. Codes expire in 10 minutes.
                </Text>
                {field('Code from email', emailCode, (v) => setEmailCode(v.replace(/\D/g, '')), { keyboard: 'number-pad', max: 6, auto: 'one-time-code' })}
                {field('Code from SMS', phoneCode, (v) => setPhoneCode(v.replace(/\D/g, '')), { keyboard: 'number-pad', max: 6, auto: 'sms-otp' })}
                {primary('Continue', confirmCodes)}
                {link('Send new codes', sendCodes)}
                {link('Change details', () => setStep('details'))}
              </>
            )}

            {mode === 'register' && step === 'pins' && (
              <>
                <View style={[styles.explain, { backgroundColor: colors.surfaceSecondary, borderRadius: radii.lg }]}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.brandAccent} />
                  <Text style={[typography.bodySmall, { color: colors.textSecondary, marginLeft: 8, flex: 1 }]}>
                    Once an SOS starts, only your <Text style={{ fontWeight: '700' }}>SOS PIN</Text> can stop it.
                    If someone forces you to stop it, enter your <Text style={{ fontWeight: '700' }}>duress PIN</Text>:
                    the app looks like it stopped, but your guardians are silently alerted.
                  </Text>
                </View>
                {field('SOS PIN (4-6 digits)', pin, (v) => setPin(v.replace(/\D/g, '')), { secure: true, keyboard: 'number-pad', max: 6, auto: 'off' })}
                {field('Repeat SOS PIN', pin2, (v) => setPin2(v.replace(/\D/g, '')), { secure: true, keyboard: 'number-pad', max: 6, auto: 'off' })}
                {field('Duress PIN (different, 4-6 digits)', duressPin, (v) => setDuressPin(v.replace(/\D/g, '')), {
                  secure: true, keyboard: 'number-pad', max: 6, auto: 'off',
                  hint: 'You can change both later in Settings after confirming a code sent to your email.' })}
                <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4, marginBottom: 6 }]}>
                  When you raise an SOS, should SHIELD also alert the police?
                </Text>
                {([true, false] as const).map((v) => (
                  <TouchableOpacity
                    key={String(v)}
                    onPress={() => setPoliceSharing(v)}
                    style={[styles.choice, { borderColor: policeSharing === v ? colors.brandAccent : colors.border, borderRadius: radii.lg }]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: policeSharing === v }}
                    accessibilityLabel={v ? 'Yes, alert the police too' : 'No, only my guardians'}
                  >
                    <Ionicons name={policeSharing === v ? 'radio-button-on' : 'radio-button-off'} size={18}
                      color={policeSharing === v ? colors.brandAccent : colors.textMuted} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={[typography.bodyMedium, { color: colors.textPrimary, fontWeight: '600' }]}>
                        {v ? 'Yes, alert the police too (recommended)' : 'No, only my guardians'}
                      </Text>
                      <Text style={[typography.caption, { color: colors.textSecondary }]}>
                        {v
                          ? 'Your name, phone and live location go to the nearest police station and 112 only while an SOS is open. Change any time in Settings.'
                          : 'Only your guardians are alerted. You can turn police alerts on later in Settings.'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {primary('Create account', createAccount)}
                {link('Back', () => setStep('codes'))}
              </>
            )}

            {mode === 'forgot' && (
              <>
                {field('Email', email, setEmail, { keyboard: 'email-address', auto: 'email' })}
                {!codeSent ? primary('Email me a reset code', sendReset) : (
                  <>
                    {field('Code from email', resetCode, (v) => setResetCode(v.replace(/\D/g, '')), { keyboard: 'number-pad', max: 6, auto: 'one-time-code' })}
                    {field('New password', password, setPassword, { secure: true, auto: 'new-password' })}
                    {field('Repeat new password', password2, setPassword2, { secure: true, auto: 'new-password' })}
                    {primary('Set new password', resetPassword)}
                    {link('Send a new code', sendReset)}
                  </>
                )}
                {link('Back to sign in', () => switchMode('login'))}
              </>
            )}

            {error && (
              <View style={[styles.notice, { backgroundColor: colors.statusWarningBg }]}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.statusWarning} />
                <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8, flex: 1 }]}>{error}</Text>
              </View>
            )}
            {info && !error && (
              <View style={[styles.notice, { backgroundColor: colors.statusSuccessBg }]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.statusSuccess} />
                <Text style={[typography.bodySmall, { color: colors.textPrimary, marginLeft: 8, flex: 1 }]}>{info}</Text>
              </View>
            )}
          </View>

          <Text style={[typography.caption, { color: colors.textMuted, textAlign: 'center', marginTop: 16 }]}>
            SHIELD is an assistive safety tool. In immediate danger, call 112.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  brand: { alignItems: 'center', marginTop: 24, marginBottom: 20 },
  card: { borderWidth: 1, padding: 18 },
  field: { marginBottom: 12 },
  input: { borderWidth: 1, height: 46, paddingHorizontal: 12, outlineWidth: 0 },
  primary: { marginTop: 6, paddingVertical: 14, alignItems: 'center' },
  link: { alignItems: 'center', paddingVertical: 10 },
  explain: { flexDirection: 'row', padding: 12, marginBottom: 14 },
  notice: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginTop: 12 },
  choice: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1.5, padding: 10, marginBottom: 8 },
});
