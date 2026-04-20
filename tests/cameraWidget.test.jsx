import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CameraWidget from '../src/widgets/types/CameraWidget.jsx';

describe('CameraWidget essential view', () => {
  it('shows stream controls and live frame statistics', () => {
    const html = renderToStaticMarkup(
      <CameraWidget
        config={{
          pvPrefix: 'EUAPS:CAM:SIM01',
          streamUrl: 'http://example.test/mjpg/video.mjpg',
          viewMode: 'essential',
          title: 'SIM01',
        }}
        client={null}
      />
    );

    expect(html).toContain('Exposure');
    expect(html).toContain('Gain');
    expect(html).toContain('Frame #');
    expect(html).toContain('fps');
  });
});
