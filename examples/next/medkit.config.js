// The three example apps share their source media in examples/media.
export default {
  srcDir: '../media',
  video: {
    files: {
      'talk.mp4': { keepAudio: true, ladder: [480, 720] },
    },
  },
};
