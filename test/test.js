var canvas = document.getElementById( 'canvas' );
var renderer = adcirc.gl_renderer()( canvas );

var sample_button = document.getElementById( 'sample_button' );
var f14_picker = document.getElementById( 'f14' );
var f63_picker = document.getElementById( 'f63' );
var f64_picker = document.getElementById( 'f64' );

var progress_bar = document.getElementById( 'progress' );
var progress_text = document.getElementById( 'percent' );

sample_button.onclick = load_sample_file;
f14_picker.onchange = function () { test_fort_14() };
f63_picker.onchange = test_fort_63;
f64_picker.onchange = test_fort_64;

function load_sample_file () {

    var xhr = new XMLHttpRequest();
    xhr.open( 'GET', 'fort.14', true );
    xhr.responseType = 'blob';
    xhr.onprogress = function ( e ) {
        progress( 100 * e.loaded/e.size );
    };
    xhr.onload = function () {
        if ( this.status == 200 ) {
            test_fort_14( this.response );
        } else {
            console.log( 'Error loading fort.14' );
        }
    };
    xhr.send();

}

function test_fort_14 ( f ) {

    f = f || f14_picker.files[0];
    var mesh = adcirc.mesh();

    var f14 = adcirc.fort14()
        .on_start( start, true )
        .on_progress( progress, true )
        .on_finish( finish, true )
        .nodes( function ( nodes ) {
            mesh.nodes( nodes );
            on_loaded();
        })
        .elements( function ( elements ) {
            mesh.elements( elements );
            on_loaded();
        })
        .read( f );

    function on_loaded () {
        if ( mesh.num_nodes() && mesh.num_elements() ) {
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