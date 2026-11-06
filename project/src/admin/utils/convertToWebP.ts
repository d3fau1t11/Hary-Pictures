// WebP conversion utility
export const convertToWebP = (file: File, quality: number = 0.8): Promise<File> => {
  return new Promise((resolve, reject) => {
    // Check if file is already WebP
    if (file.type === 'image/webp') {
      resolve(file);
      return;
    }

    // Check if file is a supported image type (including JFIF files)
    const isSupportedType = file.type.match(/^image\/(jpeg|jpg|png|webp)$/) || 
                           file.name.toLowerCase().match(/\.(jfif|jpe)$/);
    
    if (!isSupportedType) {
      reject(new Error('Unsupported file type. Please upload PNG, JPG, or JFIF images.'));
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (!ctx) { reject(new Error('Image processing is unavailable in this browser.')); return; }
      // Set canvas dimensions
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw image on canvas
      ctx.drawImage(img, 0, 0);

      // Convert to WebP
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Create new file with WebP extension
            if (blob.type !== 'image/webp') { reject(new Error('This browser cannot optimize this image. Try uploading a WebP file.')); return; }
            const webpFile = new File([blob], file.name.replace(/\.(jpg|jpeg|png|jfif|jpe)$/i, '.webp'), {
              type: 'image/webp',
              lastModified: Date.now()
            });
            resolve(webpFile);
          } else {
            reject(new Error('Failed to convert image to WebP'));
          }
        },
        'image/webp',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for conversion'));
    };

    // Load the image
    img.src = objectUrl;
  });
};

