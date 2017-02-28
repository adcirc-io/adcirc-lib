var canvas = document.getElementById( 'canvas' );
var renderer = adcirc.gl_renderer()( canvas );

var f14_picker = document.getElementById( 'f14' );
var f63_picker = document.getElementById( 'f63' );
var f64_picker = document.getElementById( 'f64' );

var progress_bar = document.getElementById( 'progress' );
var progress_text = document.getElementById( 'percent' );

f14_picker.onchange = test_fort_14;
f63_picker.onchange = test_fort_63;
f64_picker.onchange = test_fort_64;

function test_fort_14 () {

    var mesh = adcirc.mesh();

    var f14 = adcirc.fort14()
        .on_start( start, true )
        .on_progress( progress, true )
        .on_finish( finish, true )
        .nodes( function ( nodes ) {
            mesh.nodes( nodes.array );
            on_loaded();
        })
        .elements( function ( elements ) {
            mesh.elements( elements.array );
            on_loaded();
        })
        .read( f14_picker.files[0] );

    function on_loaded () {
        if ( mesh.nodes() && mesh.elements() ) {
            renderer.add_mesh( mesh );
            renderer.zoom_to( mesh, 500 );
        }
    }

}

function test_fort_63 () {

}

function test_fort_64 () {

}

function start () {
    progress_bar.style.width = 0;
    progress_text.innerHTML = '0%';
}
function progress ( p ) {
    progress_bar.style.width = p.toFixed(1) + '%';
    progress_text.innerHTML = p.toFixed(1) + '%';
}


function finish () {
    progress_bar.style.width = '100%';
    progress_text.innerHTML = '100%';
}