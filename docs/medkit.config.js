// The docs process their media like any site using medkit: the hero clip and
// the sample media come from the example apps' shared folder.
export default {
  srcDir: '../examples/media',
  video: {
    files: {
      'talk.mp4': { keepAudio: true, ladder: [480, 720] },
    },
  },
};
