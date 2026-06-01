import { useState } from 'react';
import { uploadPPT, Slide } from '@/services/api';

export function usePPT(sessionId: string | undefined) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isUploadingPPT, setIsUploadingPPT] = useState(false);

  const handlePPTUpload = async (file: File) => {
    if (!file || !sessionId) return;
    setIsUploadingPPT(true);
    try {
      const result = await uploadPPT(file, sessionId);
      if (result.slides?.length > 0) {
        setSlides(result.slides);
        setActiveSlideIndex(0);
      }
    } catch (error) { console.error('PPT upload failed:', error); }
    finally { setIsUploadingPPT(false); }
  };

  return {
    state: {
      slides,
      activeSlideIndex,
      isUploadingPPT,
    },
    actions: {
      setSlides,
      setActiveSlideIndex,
      setIsUploadingPPT,
      handlePPTUpload,
    },
  };
}
