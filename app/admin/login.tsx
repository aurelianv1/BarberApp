import { Redirect, useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { signIn, toAdminError } from '@/lib/admin';
import { useSession } from '@/lib/useSession';
import { adminErrorText, texts } from '@/texts/ro';
import { PageTitle } from '@/ui/PageTitle';
import { Button, Field, Loading, Notice, Screen, Title, type TextInputRef } from '@/ui/components';

export default function AdminLoginScreen() {
  const router = useRouter();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputRef>(null);

  if (session === 'loading') {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  // Already signed in (and not in the middle of the admin check done by signIn).
  if (session === 'signed-in' && !busy) return <Redirect href="/admin" />;

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      setError(texts.admin.login.missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/admin');
    } catch (cause) {
      setError(adminErrorText(toAdminError(cause).code));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle title={`${texts.admin.login.title} · ${texts.admin.title}`} />
      <Title>{texts.admin.login.title}</Title>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field
        label={texts.admin.login.email}
        value={email}
        onChangeText={setEmail}
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="login-email"
      />
      <Field
        ref={passwordRef}
        label={texts.admin.login.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="login-password"
      />
      <Button
        label={busy ? texts.admin.login.submitting : texts.admin.login.submit}
        busy={busy}
        onPress={submit}
        testID="login-submit"
      />
    </Screen>
  );
}
