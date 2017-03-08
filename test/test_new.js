
var canvas = d3.select( '#canvas' );
var renderer = adcirc.gl_renderer()( canvas.node() );

var progress = progress_bar().height( 2 );

var slide = slider();

progress( d3.select( '#progress' ) );
slide( d3.select( '#slider' ).style( 'margin-top', '20px' ) );


d3.select( 'body' ).on( 'keydown', function () {
    switch ( d3.event.key ) {
        case 'ArrowRight':
            progress.progress( progress.progress() + 1 );
            slide.current( slide.current() + 1 );
            break;
        case 'ArrowLeft':
            progress.progress( progress.progress() - 1 );
            slide.current( slide.current() - 1 );
            break;
        case 'ArrowUp':
            slide.count( slide.count() * 2 );
            break;
        case 'ArrowDown':
            slide.count( parseInt( slide.count() / 2 ) );
            break;
    }
});