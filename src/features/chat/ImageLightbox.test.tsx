import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithSettings } from '@/test/render-with-settings';
import { ImageLightbox } from './ImageLightbox';

describe('ImageLightbox', () => {
  it('loads only the thumbnail until the preview is opened', () => {
    const { container } = renderWithSettings(
      <ImageLightbox
        thumbnailSrc="/thumbnail.webp"
        originalSrc="/original.png"
        alt="Result"
      />,
    );

    expect(container.querySelector('img[src="/thumbnail.webp"]')).toBeInTheDocument();
    expect(document.querySelector('img[src="/original.png"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('img', { name: 'Result' }));

    expect(document.querySelector('img[src="/original.png"]')).toBeInTheDocument();
  });
});
