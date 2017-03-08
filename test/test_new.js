
var canvas = d3.select( '#canvas' );
var renderer = adcirc.gl_renderer()( canvas.node() );

var progress = progress_bar()
    .height( 5 )
    .progress( 0 );

progress( d3.select( '#progress' ) );



d3.select( 'body' ).on( 'keydown', function () {
    switch ( d3.event.key ) {
        case 'ArrowRight':
            progress.progress( progress.progress() + 1 );
            break;
        case 'ArrowLeft':
            progress.progress( progress.progress() - 1 );
            break;
    }
});