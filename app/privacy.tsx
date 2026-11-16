import React from 'react';
import { PageTitle } from '@/ui/PageTitle';
import { useRouter } from 'expo-router';

import { texts } from '@/texts/ro';
import { Body, Button, Heading, Screen, Title } from '@/ui/components';

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <Screen>
      <PageTitle title={texts.privacy.title} />
      <Button
        label={`‹ ${texts.common.back}`}
        variant="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Title>{texts.privacy.title}</Title>
      {texts.privacy.sections.map((section) => (
        <React.Fragment key={section.heading}>
          <Heading>{section.heading}</Heading>
          <Body>{section.body}</Body>
        </React.Fragment>
      ))}
    </Screen>
  );
}
